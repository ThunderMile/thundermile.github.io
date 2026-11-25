import BackgroundTasks
import CryptoKit
import Foundation
import HealthKit
import OSLog

enum HealthSyncKind: String, CaseIterable, Codable {
    case run, sleep
}

struct SavedHealthSummary: Codable, Equatable {
    let kind: HealthSyncKind
    let id: String
    let durationSeconds: Int
    var startedAt: Date?
    var distanceMeters: Int?

    var key: String { "\(kind.rawValue):\(id)" }
}

enum ActivitySource: String, Codable {
    case bedtime, heart, location, music, video
    case sleepStage = "sleep_stage"
}

struct ActivitySignal: Codable {
    let source: ActivitySource
    let action: String
    let at: Date
    var bpm: Int?
    var measuredAt: Date?
    var stage: String?
    var startedAt: Date?
    var endedAt: Date?
    var place: String?
    var city: String?
    var app: String?
    var track: String?
    var artist: String?

    init(source: ActivitySource, action: String, at: Date) {
        self.source = source
        self.action = action
        self.at = at
    }

}

enum HealthSyncPreferences {
    static func origin(for kind: HealthSyncKind) -> String? {
        UserDefaults.standard.string(forKey: "automaticSummary.\(kind.rawValue)")
    }

    static func set(_ origin: String?, for kind: HealthSyncKind) {
        UserDefaults.standard.set(origin, forKey: "automaticSummary.\(kind.rawValue)")
    }

    static func isEnabled(_ kind: HealthSyncKind, for origin: String) -> Bool { self.origin(for: kind) == origin }
}

enum ActivityPreferences {
    static func origin(for source: ActivitySource) -> String? {
        UserDefaults.standard.string(forKey: "publicActivity.\(source.rawValue)")
    }

    static func set(_ origin: String?, for source: ActivitySource) {
        UserDefaults.standard.set(origin, forKey: "publicActivity.\(source.rawValue)")
    }

    static func isEnabled(_ source: ActivitySource, for origin: String) -> Bool { self.origin(for: source) == origin }
}

enum HealthSync {
    static func manual(_ kind: HealthSyncKind) async throws -> String {
        let service = UploadService.shared
        let origin = try await service.configuredOrigin()
        let at = Date.now
        guard let summary = try await summary(kind) else {
            return kind == .run ? "No readable saved run to sync." : "No readable sleep to sync."
        }
        guard let origin, try await service.configuredOrigin() == origin else { throw UploadError.configurationRequired }
        guard let id = try await service.queueHealth(summary, at: at, expectedOrigin: origin) else {
            return UploadOutcome.unchanged.message
        }
        return try await service.attempt(id, at: origin).message
    }

    static func summary(_ kind: HealthSyncKind) async throws -> SavedHealthSummary? {
        let health = HealthReader.shared
        switch kind {
        case .run:
            guard let run = try await health.latestRun(), let id = run.sampleID, run.duration > 0 else { return nil }
            let digest = SHA256.hash(data: Data(id.uuidString.utf8)).map { String(format: "%02x", $0) }.joined()
            return SavedHealthSummary(kind: .run, id: digest, durationSeconds: max(1, Int(run.duration.rounded())),
                                      startedAt: run.date, distanceMeters: run.kilometers.map { Int(($0 * 1000).rounded()) })
        case .sleep:
            guard let sleep = try await health.latestSleep() else { return nil }
            let day = DateFormatter()
            day.locale = Locale(identifier: "en_US_POSIX")
            day.calendar = Calendar(identifier: .gregorian)
            day.dateFormat = "yyyy-MM-dd"
            return SavedHealthSummary(kind: .sleep, id: day.string(from: sleep.date),
                                      durationSeconds: max(1, Int(sleep.seconds.rounded())))
        }
    }
}

@MainActor
final class HealthBackground {
    static let shared = HealthBackground()

    enum Observation: String, CaseIterable {
        case workout, sleep, heart

        var sampleType: HKSampleType {
            switch self {
            case .workout: HKObjectType.workoutType()
            case .sleep: HKCategoryType(.sleepAnalysis)
            case .heart: HKQuantityType(.heartRate)
            }
        }

        var enabled: Bool {
            #if DEBUG && !targetEnvironment(simulator)
            if self != .workout && HealthDeliveryDiagnostics.enabled { return true }
            #endif
            return switch self {
            case .workout: HealthSyncPreferences.origin(for: .run) != nil
            case .sleep: HealthSyncPreferences.origin(for: .sleep) != nil || ActivityPreferences.origin(for: .sleepStage) != nil
            case .heart: ActivityPreferences.origin(for: .heart) != nil
            }
        }

        var retryKey: String { "healthReadRetry.\(rawValue)" }
    }

    private let health = HealthReader.shared
    private var queries: [Observation: HKObserverQuery] = [:]
    private var reading: Set<Observation> = []
    private var recapture: Set<Observation> = []

    func installEnabledObservers() {
        #if !targetEnvironment(simulator)
        guard HKHealthStore.isHealthDataAvailable() else { return }
        for observation in Observation.allCases where observation.enabled && queries[observation] == nil {
            let predicate = observation == .workout ? HKQuery.predicateForWorkouts(with: .running) : nil
            let query = HKObserverQuery(sampleType: observation.sampleType, predicate: predicate) { _, completion, error in
                Task { @MainActor in
                    if observation.enabled { await self.capture(observation, error: error) }
                    await BackgroundRetry.schedule()
                    completion()
                    await BackgroundRetry.flush()
                }
            }
            queries[observation] = query
            health.store.execute(query)
        }
        #endif
    }

    func updateRegistration() async throws {
        #if !targetEnvironment(simulator)
        guard HKHealthStore.isHealthDataAvailable() else { throw CocoaError(.featureUnsupported) }
        installEnabledObservers()
        for observation in Observation.allCases {
            if observation.enabled {
                try await health.store.enableBackgroundDelivery(for: observation.sampleType, frequency: .immediate)
            } else if let query = queries.removeValue(forKey: observation) {
                health.store.stop(query)
                setRetry(nil, for: observation)
                try await health.store.disableBackgroundDelivery(for: observation.sampleType)
            }
        }
        #endif
    }

    var nextAttempt: Date? {
        Observation.allCases.filter(\.enabled).compactMap { retry(for: $0)?.due }.min()
    }

    func retryDue() async {
        for observation in Observation.allCases where observation.enabled && (retry(for: observation)?.due ?? .distantFuture) <= .now {
            await capture(observation)
        }
    }

    func readOnForeground() async {
        #if !targetEnvironment(simulator)
        for observation in [Observation.heart, .sleep] where observation.enabled {
            await capture(observation)
        }
        #endif
    }

    private func capture(_ observation: Observation, error: Error? = nil) async {
        guard reading.insert(observation).inserted else {
            recapture.insert(observation)
            return
        }
        defer { reading.remove(observation) }
        await captureOnce(observation, error: error)
        while recapture.remove(observation) != nil && observation.enabled {
            await captureOnce(observation)
        }
    }

    private func captureOnce(_ observation: Observation, error: Error? = nil) async {
        do {
            if let error { throw error }
            let at = Date.now
            #if DEBUG && !targetEnvironment(simulator)
            if HealthDeliveryDiagnostics.enabled && observation != .workout {
                try await HealthDeliveryDiagnostics.record(observation, through: at)
            }
            #endif
            guard let origin = try await UploadService.shared.configuredOrigin() else {
                setRetry(nil, for: observation)
                return
            }
            let summaryKind: HealthSyncKind = observation == .workout ? .run : .sleep
            if observation != .heart, HealthSyncPreferences.isEnabled(summaryKind, for: origin),
               let summary = try await HealthSync.summary(summaryKind) {
                _ = try await UploadService.shared.queueHealth(summary, at: at, expectedOrigin: origin, automatic: true)
            }
            if observation == .heart, ActivityPreferences.isEnabled(.heart, for: origin),
               let heart = try await latestWatchHeart() {
                try await UploadService.shared.queueSignal(heart, for: origin)
            }
            if observation == .sleep, ActivityPreferences.isEnabled(.sleepStage, for: origin),
               let stage = try await latestSleepStage() {
                try await UploadService.shared.queueSignal(stage, for: origin)
            }
            setRetry(nil, for: observation)
        } catch {
            var state = retry(for: observation) ?? RetryState()
            state.failed(error)
            setRetry(state, for: observation)
        }
    }

    private func latestWatchHeart() async throws -> ActivitySignal? {
        let now = Date.now
        // Match the website's display window for a Watch measurement.
        let samples = try await health.heartSamples(since: now.addingTimeInterval(-20 * 60), through: now)
        guard let sample = samples.first(where: HealthReader.isWatchMeasurement)
        else { return nil }
        let bpm = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        guard bpm.isFinite, bpm > 0, bpm <= 300 else { return nil }
        var signal = ActivitySignal(source: .heart, action: "reading", at: .now)
        signal.bpm = Int(bpm.rounded())
        signal.measuredAt = sample.endDate
        return signal
    }

    private func latestSleepStage() async throws -> ActivitySignal? {
        let now = Date.now
        let stages: [HKCategoryValueSleepAnalysis: String] = [.asleepREM: "REM", .asleepCore: "Core", .asleepDeep: "Deep", .awake: "Awake"]
        for sample in try await health.watchSleepSamples(since: now.addingTimeInterval(-120), through: now) {
            guard let value = HKCategoryValueSleepAnalysis(rawValue: sample.value), let stage = stages[value] else { continue }
            var signal = ActivitySignal(source: .sleepStage, action: "reading", at: now)
            signal.stage = stage
            signal.startedAt = sample.startDate
            signal.endedAt = sample.endDate
            return signal
        }
        return nil
    }

    private func retry(for observation: Observation) -> RetryState? {
        guard let data = UserDefaults.standard.data(forKey: observation.retryKey) else { return nil }
        return try? JSONDecoder().decode(RetryState.self, from: data)
    }

    private func setRetry(_ state: RetryState?, for observation: Observation) {
        UserDefaults.standard.set(state.flatMap { try? JSONEncoder().encode($0) }, forKey: observation.retryKey)
    }
}

@MainActor
enum BackgroundRetry {
    private static let identifier = "io.github.thundermile.HealthPreview.retry"
    private static let logger = Logger(subsystem: "io.github.thundermile.HealthPreview", category: "BackgroundDelivery")

    static func register() {
        #if !targetEnvironment(simulator)
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            let work = Task { @MainActor in
                await run()
                task.setTaskCompleted(success: !Task.isCancelled)
            }
            task.expirationHandler = { work.cancel() }
        }
        #endif
    }

    static func run() async {
        await HealthBackground.shared.retryDue()
        await flush()
    }

    static func flush() async {
        do { try await UploadService.shared.flush() }
        catch { logger.error("Could not read or write the pending upload queue.") }
        await schedule()
    }

    static func schedule() async {
        #if !targetEnvironment(simulator)
        let upload = try? await UploadService.shared.nextAttempt()
        guard let due = [upload, HealthBackground.shared.nextAttempt].compactMap({ $0 }).min() else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = max(due, .now.addingTimeInterval(30))
        do { try BGTaskScheduler.shared.submit(request) }
        catch { logger.error("iOS did not accept the background retry request.") }
        #endif
    }
}
