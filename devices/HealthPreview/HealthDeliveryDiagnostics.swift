#if DEBUG && !targetEnvironment(simulator)
import HealthKit
import SwiftUI
import UIKit

@MainActor
enum HealthDeliveryDiagnostics {
    nonisolated static let preference = "recordWatchDeliveryTiming"
    nonisolated static var enabled: Bool { UserDefaults.standard.bool(forKey: preference) }

    struct Reading: Codable, Identifiable {
        let id: UUID
        let kind: String
        let startedAt: Date
        let endedAt: Date
        let firstReadAt: Date
        let appWasActive: Bool
        let protectedDataAvailable: Bool
    }

    private static let directory = URL.applicationSupportDirectory.appending(path: "DeliveryDiagnostics",
                                                                             directoryHint: .isDirectory)
    private static var file: URL { directory.appending(path: "watch.json") }

    static func readings() throws -> [Reading] {
        do { return try JSONDecoder().decode([Reading].self, from: Data(contentsOf: file)) }
        catch CocoaError.fileReadNoSuchFile { return [] }
    }

    static func record(_ observation: HealthBackground.Observation, through end: Date) async throws {
        let health = HealthReader.shared
        let samples: [HKSample]
        switch observation {
        case .heart:
            samples = try await health.heartSamples(since: end.addingTimeInterval(-1800), through: end)
                .filter(HealthReader.isWatchMeasurement)
        case .sleep: samples = try await health.watchSleepSamples(since: end.addingTimeInterval(-172_800), through: end)
        case .workout: return
        }
        guard enabled else { return }
        let firstRead = Date.now
        let active = UIApplication.shared.applicationState == .active
        let unlocked = UIApplication.shared.isProtectedDataAvailable
        let previous = try readings()
        let existing = Set(previous.map(\.id))
        let new = samples.filter { !existing.contains($0.uuid) }.map { sample in
            Reading(id: sample.uuid, kind: observation == .heart ? "Heart rate" : "Sleep",
                    startedAt: sample.startDate, endedAt: sample.endDate, firstReadAt: firstRead,
                    appWasActive: active, protectedDataAvailable: unlocked)
        }
        guard !new.isEmpty else { return }
        let cutoff = firstRead.addingTimeInterval(-259_200)
        let combined = (previous + new).filter { $0.endedAt >= cutoff }
            .sorted { $0.endedAt > $1.endedAt }.prefix(1536)
        var folder = directory
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        try folder.setResourceValues(resource)
        try JSONEncoder().encode(Array(combined)).write(to: file,
                                                        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

struct HealthDeliveryDiagnosticsView: View {
    @AppStorage(HealthDeliveryDiagnostics.preference) private var enabled = false
    @State private var readings: [HealthDeliveryDiagnostics.Reading] = []
    @State private var error = ""
    @State private var heartCheck = ""
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                Toggle("Record Watch delivery timing", isOn: Binding(get: { enabled }, set: setEnabled))
                Button("Read Available Samples") { update {
                    let now = Date.now
                    let samples = try await HealthReader.shared.heartSamples(since: now.addingTimeInterval(-3600), through: now)
                    let watch = samples.filter(HealthReader.isWatchMeasurement)
                    let counts = "Last hour: \(samples.count) readable heart-rate samples, \(watch.count) from Apple Watch."
                    if let recent = watch.first {
                        let age = Int(now.timeIntervalSince(recent.endDate))
                        heartCheck = counts + " Latest Watch sample is \(age) seconds old."
                    } else {
                        heartCheck = counts
                    }
                    await HealthBackground.shared.readOnForeground()
                    await BackgroundRetry.flush()
                } }
                    .disabled(!enabled)
                if !heartCheck.isEmpty { Text(heartCheck) }
                if !error.isEmpty { Text(error) }
            } footer: {
                Text("Sample intervals and the first time this app could read them are stored on this iPhone for up to three days. This setting is independent of sharing.")
            }
            Section("First read") {
                ForEach(readings.prefix(40)) { reading in
                    VStack(alignment: .leading) {
                        Text(reading.kind)
                        Text("Start \(timestamp(reading.startedAt))")
                        Text("End \(timestamp(reading.endedAt))")
                        Text("Read \(timestamp(reading.firstReadAt)) · \(reading.appWasActive ? "Foreground" : "Background")")
                        Text(reading.protectedDataAvailable ? "Protected data available" : "Protected data unavailable")
                    }
                    .font(.caption)
                }
            }
        }
        .disabled(busy)
        .navigationTitle("Health Delivery Timing")
        .task { refresh() }
    }

    private func timestamp(_ date: Date) -> String {
        date.formatted(.dateTime.month().day().hour().minute().second())
    }

    private func setEnabled(_ value: Bool) {
        update {
            if value { try await HealthReader.shared.authorize() }
            enabled = value
            try await HealthBackground.shared.updateRegistration()
            if value { await HealthBackground.shared.readOnForeground() }
        }
    }

    private func update(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true
        Task { @MainActor in
            defer { busy = false }
            error = ""
            do { try await work() }
            catch { self.error = error.localizedDescription }
            refresh()
            await BackgroundRetry.schedule()
        }
    }

    private func refresh() {
        do { readings = try HealthDeliveryDiagnostics.readings() }
        catch { self.error = error.localizedDescription }
    }
}
#endif
