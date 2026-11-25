import Foundation
import Security

enum UploadError: LocalizedError {
    case configurationRequired
    case invalidBackend
    case invalidToken
    case keychain(OSStatus)
    case invalidResponse
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .configurationRequired: "Set the backend URL and write token in Sync Settings."
        case .invalidBackend:
            #if targetEnvironment(simulator)
            "Enter a local preview URL such as http://127.0.0.1:8768."
            #elseif DEBUG
            "Enter an HTTPS backend origin, or your private-IP device preview URL."
            #else
            "Enter the HTTPS backend origin without a path, login, query, or fragment."
            #endif
        case .invalidToken: "Enter a valid write token."
        case .keychain(let status): "The app could not access its Keychain settings (\(status))."
        case .invalidResponse: "The backend did not acknowledge the upload."
        case .http(401): "The backend rejected the write token (HTTP 401)."
        case .http(let status): "The backend returned HTTP \(status)."
        }
    }

    var canRetryAutomatically: Bool {
        switch self {
        case .http(let status): status == 408 || status == 429 || (500...599).contains(status)
        case .invalidResponse: true
        default: false
        }
    }
}

private struct BackendConfiguration: Codable {
    let origin: URL
    let token: String

    static func parseOrigin(_ text: String) throws -> URL {
        guard var parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.port.map({ (1...65535).contains($0) }) ?? true
        else { throw UploadError.invalidBackend }

        #if targetEnvironment(simulator)
        guard parts.scheme?.lowercased() == "http", host == "127.0.0.1" else { throw UploadError.invalidBackend }
        #elseif DEBUG
        guard parts.scheme?.lowercased() == "https" ||
                (parts.scheme?.lowercased() == "http" && isPrivateIPv4(host)) else { throw UploadError.invalidBackend }
        #else
        guard parts.scheme?.lowercased() == "https" else { throw UploadError.invalidBackend }
        #endif

        parts.scheme = parts.scheme?.lowercased()
        parts.host = host
        parts.path = ""
        guard let url = parts.url else { throw UploadError.invalidBackend }
        return url
    }

    #if DEBUG && !targetEnvironment(simulator)
    private static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        let octets = parts.compactMap { UInt8($0) }
        guard parts.count == 4, octets.count == 4,
              host == octets.map(String.init).joined(separator: ".") else { return false }
        return octets[0] == 10 || (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }
    #endif
}

private enum BackendKeychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "io.github.thundermile.HealthPreview.backend",
        kSecAttrAccount as String: "configuration"
    ]

    static func load() throws -> BackendConfiguration? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw UploadError.keychain(status) }
        let config = try JSONDecoder().decode(BackendConfiguration.self, from: data)
        _ = try BackendConfiguration.parseOrigin(config.origin.absoluteString)
        return config
    }

    static func save(_ configuration: BackendConfiguration) throws {
        let data = try JSONEncoder().encode(configuration)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let item = query.merging(attributes) { _, value in value }
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw UploadError.keychain(status) }
    }
}

enum UploadOutcome {
    case sent
    case unchanged
    case queued(String?)

    var message: String {
        switch self {
        case .sent: "Upload acknowledged by the backend."
        case .unchanged: "Already synced."
        case .queued(let reason): "Upload queued." + (reason.map { " " + $0 } ?? "")
        }
    }
}

struct RetryState: Codable {
    var attempts = 0
    var due: Date? = .distantPast
    var reason: String?

    mutating func failed(_ error: Error) {
        attempts += 1
        reason = (error as? UploadError)?.localizedDescription ?? "Try again when the backend is reachable."
        let delay = min(3_600, 30 * pow(2, Double(min(attempts - 1, 7))))
        due = (error as? UploadError)?.canRetryAutomatically == false ? nil : .now.addingTimeInterval(delay)
    }
}

private enum UploadPayload: Codable {
    case workout(WorkoutEvent)
    case health(SavedHealthSummary)
    case signal(ActivitySignal)

    var summary: SavedHealthSummary? {
        if case .health(let summary) = self { return summary }
        return nil
    }
}

private struct UploadJob: Codable, Identifiable {
    var id = UUID()
    let at: Date
    let payload: UploadPayload
    var automatic = false
    var retry = RetryState()
}

private struct HealthReceipt: Codable {
    let at: Date
    let summary: SavedHealthSummary
}

private struct BackendQueue: Codable {
    var jobs: [UploadJob] = []
    var receipts: [HealthSyncKind: HealthReceipt] = [:]
    var lastWorkoutMillis: Int64 = 0
    var latestSignals: [ActivitySource: Date] = [:]
    var latestLocation: ActivitySignal?
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct BackendClient {
    let session: URLSession = {
        let settings = URLSessionConfiguration.ephemeral
        settings.timeoutIntervalForRequest = 8
        settings.timeoutIntervalForResource = 12
        settings.httpShouldSetCookies = false
        settings.urlCredentialStorage = nil
        return URLSession(configuration: settings, delegate: RejectRedirects(), delegateQueue: nil)
    }()

    func send(_ job: UploadJob, to backend: BackendConfiguration) async throws {
        struct SummaryEvent: Encodable {
            let at: Date
            let summary: SavedHealthSummary
        }
        struct Acknowledgement: Decodable { let applied: Bool }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        let path: String
        let body: Data
        switch job.payload {
        case .workout(let event):
            path = "api/events"
            body = try encoder.encode(event)
        case .health(let summary):
            path = "api/health/summaries"
            body = try encoder.encode(SummaryEvent(at: job.at, summary: summary))
        case .signal(let signal):
            path = "api/events"
            body = try encoder.encode(signal)
        }

        var request = URLRequest(url: backend.origin.appending(path: path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + backend.token, forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw UploadError.invalidResponse }
        guard (200...299).contains(http.statusCode) else { throw UploadError.http(http.statusCode) }
        guard (try? JSONDecoder().decode(Acknowledgement.self, from: data)) != nil else {
            throw UploadError.invalidResponse
        }
    }

    #if DEBUG && !targetEnvironment(simulator)
    func checkLocalPreview(_ backend: BackendConfiguration) async throws {
        var request = URLRequest(url: backend.origin.appending(path: "api/preview/check"))
        request.httpMethod = "POST"
        request.setValue("Bearer " + backend.token, forHTTPHeaderField: "Authorization")
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw UploadError.invalidResponse }
        guard http.statusCode == 204 else { throw UploadError.http(http.statusCode) }
    }
    #endif
}

actor UploadService {
    static let shared = UploadService()

    private let client = BackendClient()
    private let directory = URL.applicationSupportDirectory.appending(path: "PendingUploads", directoryHint: .isDirectory)
    private var flushing = false

    func configuredOrigin() throws -> String? {
        try BackendKeychain.load()?.origin.absoluteString
    }

    #if DEBUG && !targetEnvironment(simulator)
    func checkLocalPreview() async throws {
        guard let backend = try BackendKeychain.load(), backend.origin.scheme == "http" else {
            throw UploadError.configurationRequired
        }
        try await client.checkLocalPreview(backend)
    }
    #endif

    func configure(origin text: String, token input: String) throws {
        let origin = try BackendConfiguration.parseOrigin(text)
        var token = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if token.isEmpty, let existing = try BackendKeychain.load(), existing.origin == origin { token = existing.token }
        guard !token.isEmpty, token.utf8.allSatisfy({ (33...126).contains($0) }) else { throw UploadError.invalidToken }
        #if DEBUG && !targetEnvironment(simulator)
        if origin.scheme == "http", !token.hasPrefix("device-preview-") { throw UploadError.invalidToken }
        #endif
        try BackendKeychain.save(BackendConfiguration(origin: origin, token: token))
    }

    func sendWorkout(_ action: WorkoutAction, kind: WorkoutKind? = nil) async throws -> UploadOutcome {
        let origin = try requireOrigin()
        let id = try updateQueue(origin) { queue in
            let now = Int64(Date.now.timeIntervalSince1970 * 1000)
            let millis = max(now, queue.lastWorkoutMillis + 1)
            queue.lastWorkoutMillis = millis
            let at = Date(timeIntervalSince1970: Double(millis) / 1000)
            let event = WorkoutEvent(action: action, kind: kind, at: at)
            let job = UploadJob(at: at, payload: .workout(event))
            queue.jobs.append(job)
            return job.id
        }
        return try await attempt(id, at: origin)
    }

    func sendActivity(_ source: ActivitySource, _ action: WorkoutAction, app: String? = nil) async throws -> UploadOutcome {
        let origin = try requireOrigin()
        var signal = ActivitySignal(source: source, action: action.rawValue, at: .now)
        signal.app = app
        let id = try updateQueue(origin) { queue in
            let job = UploadJob(at: signal.at, payload: .signal(signal))
            queue.jobs.append(job)
            return job.id
        }
        return try await attempt(id, at: origin)
    }

    func queueSignal(_ signal: ActivitySignal, for origin: String) throws {
        guard try configuredOrigin() == origin, ActivityPreferences.isEnabled(signal.source, for: origin) else { return }
        try updateQueue(origin) { appendSignal(signal, to: &$0) }
    }

    func clearSignal(_ source: ActivitySource, for origin: String) throws {
        let signal = ActivitySignal(source: source, action: "end", at: .now)
        try updateQueue(origin) { queue in
            queue.jobs.removeAll { job in
                if case .signal(let pending) = job.payload { return pending.source == source }
                return false
            }
            appendSignal(signal, to: &queue)
        }
    }

    private func appendSignal(_ signal: ActivitySignal, to queue: inout BackendQueue) {
        let measured = signal.measuredAt ?? signal.endedAt ?? signal.at
        if let latest = queue.latestSignals[signal.source], measured <= latest { return }
        if signal.source == .location {
            if let last = queue.latestLocation, last.action == signal.action,
               last.place == signal.place, last.city == signal.city,
               signal.at.timeIntervalSince(last.at) < 43_200 { return }
            queue.latestLocation = signal
        }
        if signal.source == .location || signal.source == .music {
            queue.jobs.removeAll { job in
                if case .signal(let old) = job.payload { return old.source == signal.source }
                return false
            }
        }
        queue.latestSignals[signal.source] = measured
        queue.jobs.append(UploadJob(at: signal.at, payload: .signal(signal)))
    }

    func queueHealth(_ summary: SavedHealthSummary, at observedAt: Date, expectedOrigin: String, automatic: Bool = false) throws -> UUID? {
        let origin = try requireOrigin()
        guard expectedOrigin == origin else { throw UploadError.configurationRequired }
        if automatic && !HealthSyncPreferences.isEnabled(summary.kind, for: origin) { return nil }
        return try updateQueue(origin) { queue in
            let existing = queue.jobs.firstIndex { $0.payload.summary?.key == summary.key }
            if let existing, queue.jobs[existing].payload.summary == summary {
                if !automatic { queue.jobs[existing].automatic = false }
                return queue.jobs[existing].id
            }
            if let existing, queue.jobs[existing].at > observedAt { return queue.jobs[existing].id }
            if let receipt = queue.receipts[summary.kind], receipt.summary.key == summary.key {
                if receipt.at > observedAt || (existing == nil && receipt.summary == summary) { return nil }
            }

            if let existing { queue.jobs.remove(at: existing) }
            let job = UploadJob(at: observedAt, payload: .health(summary), automatic: automatic)
            queue.jobs.append(job)
            return job.id
        }
    }

    func attempt(_ id: UUID, at origin: String) async throws -> UploadOutcome {
        await BackgroundRetry.schedule()
        try await flush()
        await BackgroundRetry.schedule()
        let queued = try readQueues()[origin]?.jobs.first { $0.id == id }
        if let queued { return .queued(queued.retry.reason) }
        return .sent
    }

    func pendingCount() throws -> Int {
        guard let origin = try configuredOrigin() else { return 0 }
        return try readQueues()[origin]?.jobs.count ?? 0
    }

    func nextAttempt() throws -> Date? {
        guard let origin = try configuredOrigin() else { return nil }
        return try readQueues()[origin]?.jobs.compactMap(\.retry.due).min()
    }

    func flush(force: Bool = false) async throws {
        if force {
            let origin = try requireOrigin()
            try updateQueue(origin) { queue in
                for index in queue.jobs.indices { queue.jobs[index].retry.due = .distantPast }
            }
        }
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }

        while !Task.isCancelled, let configuration = try BackendKeychain.load() {
            let origin = configuration.origin.absoluteString
            guard let job = try readQueues()[origin]?.jobs.first(where: { ($0.retry.due ?? .distantFuture) <= .now }) else { return }
            let summary = job.payload.summary
            if job.automatic, let summary, !HealthSyncPreferences.isEnabled(summary.kind, for: origin) {
                try updateQueue(origin) { $0.jobs.removeAll { $0.id == job.id } }
                continue
            }
            if case .signal(let signal) = job.payload {
                let musicStart = signal.source == .music && signal.action == "start"
                let sharingOff = !ActivityPreferences.isEnabled(signal.source, for: origin)
                if (signal.action == "reading" && sharingOff) ||
                    (musicStart && (sharingOff || Date.now.timeIntervalSince(signal.at) >= MusicSharing.lifetime)) {
                    try updateQueue(origin) { $0.jobs.removeAll { $0.id == job.id } }
                    continue
                }
            }

            do {
                try await client.send(job, to: configuration)
            } catch {
                if Task.isCancelled { return }
                try updateQueue(origin) { queue in
                    let index = queue.jobs.firstIndex { $0.id == job.id }
                    if let index { queue.jobs[index].retry.failed(error) }
                }
                continue
            }

            try updateQueue(origin) { queue in
                queue.jobs.removeAll { $0.id == job.id }
                if let summary { queue.receipts[summary.kind] = HealthReceipt(at: job.at, summary: summary) }
            }
        }
    }

    func stopAutomatic(_ kind: HealthSyncKind) throws {
        guard let origin = try configuredOrigin() else { return }
        try updateQueue(origin) { queue in
            queue.jobs.removeAll { $0.automatic && $0.payload.summary?.kind == kind }
        }
    }

    private func requireOrigin() throws -> String {
        guard let origin = try configuredOrigin() else { throw UploadError.configurationRequired }
        return origin
    }

    private var stateFile: URL { directory.appending(path: "queue.json") }

    private func readQueues() throws -> [String: BackendQueue] {
        do {
            let queues = try JSONDecoder().decode([String: BackendQueue].self, from: Data(contentsOf: stateFile))
            return queues.mapValues { savedQueue in
                var queue = savedQueue
                queue.jobs.removeAll { job in
                    if case .workout(let event) = job.payload { return event.belongsToRetiredCompanion }
                    return false
                }
                return queue
            }
        } catch CocoaError.fileReadNoSuchFile {
            return [:]
        }
    }

    private func updateQueue<Value>(_ origin: String, _ change: (inout BackendQueue) -> Value) throws -> Value {
        var queues = try readQueues()
        let result = change(&queues[origin, default: BackendQueue()])
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var folder = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        try JSONEncoder().encode(queues).write(to: stateFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return result
    }
}
