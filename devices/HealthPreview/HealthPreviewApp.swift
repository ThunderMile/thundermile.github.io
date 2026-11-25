import Foundation
import HealthKit
import SwiftUI

struct RunSummary {
    let date: Date
    let kilometers: Double?
    let duration: TimeInterval
    let heartRate: Double?
    var sampleID: UUID? = nil

    var pace: String {
        guard let kilometers, kilometers > 0, duration > 0 else { return "Unavailable" }
        let seconds = Int((duration / kilometers).rounded())
        return String(format: "%d:%02d min/km", seconds / 60, seconds % 60)
    }
}

struct SleepSegment {
    let interval: DateInterval
    let stage: HKCategoryValueSleepAnalysis
}

struct SleepSummary {
    let date: Date
    let seconds: TimeInterval
    let stages: [HKCategoryValueSleepAnalysis: TimeInterval]

    // Use local noon boundaries so a night can cross midnight.
    static func latest(from segments: [SleepSegment], calendar: Calendar = .current) -> Self? {
        func nightEnding(for date: Date) -> Date {
            let noon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date)!
            return date <= noon ? noon : calendar.date(byAdding: .day, value: 1, to: noon)!
        }

        let asleep: Set<HKCategoryValueSleepAnalysis> = [.asleepUnspecified, .asleepREM, .asleepCore, .asleepDeep]
        let stageValues: Set<HKCategoryValueSleepAnalysis> = [.asleepREM, .asleepCore, .asleepDeep]
        let relevant = segments.filter { asleep.contains($0.stage) || $0.stage == .awake }
        let nights = Set(relevant.filter { asleep.contains($0.stage) }.map { nightEnding(for: $0.interval.end) })
        for end in nights.sorted(by: >) {
            guard let start = calendar.date(byAdding: .day, value: -1, to: end) else { continue }
            let window = DateInterval(start: start, end: end)
            let clipped = relevant.compactMap { segment -> SleepSegment? in
                guard let interval = segment.interval.intersection(with: window), interval.duration > 0 else { return nil }
                return SleepSegment(interval: interval, stage: segment.stage)
            }
            let boundaries = Set(clipped.flatMap { [$0.interval.start, $0.interval.end] }).sorted()
            var total: TimeInterval = 0
            var stages: [HKCategoryValueSleepAnalysis: TimeInterval] = [:]
            for (left, right) in zip(boundaries, boundaries.dropFirst()) {
                let active = Set(clipped.filter { $0.interval.start <= left && $0.interval.end >= right }.map(\.stage))
                guard !active.contains(.awake), !active.isDisjoint(with: asleep) else { continue }
                let seconds = right.timeIntervalSince(left)
                total += seconds
                let specific = active.intersection(stageValues)
                if specific.count == 1, let stage = specific.first {
                    stages[stage, default: 0] += seconds
                }
            }
            if total > 0 { return Self(date: end, seconds: total, stages: stages) }
        }
        return nil
    }
}

struct HealthReader {
    static let shared = HealthReader()
    let store = HKHealthStore()
    private let workout = HKObjectType.workoutType()
    private let heartRate = HKQuantityType(.heartRate)
    private let sleep = HKCategoryType(.sleepAnalysis)

    func authorize() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw CocoaError(.featureUnsupported) }
        try await store.requestAuthorization(toShare: [], read: [workout, heartRate, sleep])
    }

    static func isWatchMeasurement(_ sample: HKSample) -> Bool {
        guard sample.metadata?[HKMetadataKeyWasUserEntered] as? Bool != true else { return false }
        if sample.sourceRevision.productType?.hasPrefix("Watch") == true { return true }
        guard let device = sample.device, ["apple", "apple inc."].contains(device.manufacturer?.lowercased() ?? ""),
              let model = device.model?.lowercased() else { return false }
        return model == "watch" || model == "apple watch" || model.hasPrefix("apple watch ")
    }

    func heartSamples(since start: Date, through end: Date) async throws -> [HKQuantitySample] {
        let recent = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictEndDate)
        let query = HKSampleQueryDescriptor(predicates: [.quantitySample(type: heartRate, predicate: recent)],
                                            sortDescriptors: [SortDescriptor(\HKQuantitySample.endDate, order: .reverse)])
        return try await query.result(for: store)
    }

    func watchSleepSamples(since start: Date, through end: Date) async throws -> [HKCategorySample] {
        let recent = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictEndDate)
        let query = HKSampleQueryDescriptor(predicates: [.categorySample(type: sleep, predicate: recent)],
                                            sortDescriptors: [SortDescriptor(\HKCategorySample.endDate, order: .reverse)])
        return try await query.result(for: store).filter(Self.isWatchMeasurement)
    }

    func latestRun() async throws -> RunSummary? {
        let runs = HKSamplePredicate.workout(HKQuery.predicateForWorkouts(with: .running))
        let query = HKSampleQueryDescriptor(predicates: [runs], sortDescriptors: [SortDescriptor(\HKWorkout.endDate, order: .reverse)], limit: 1)
        guard let run = try await query.result(for: store).first else { return nil }
        let distance = run.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity() ?? run.totalDistance
        let rateUnit = HKUnit.count().unitDivided(by: .minute())
        let rate = run.statistics(for: heartRate)?.averageQuantity()?.doubleValue(for: rateUnit)
        return RunSummary(date: run.startDate, kilometers: distance?.doubleValue(for: .meterUnit(with: .kilo)),
                          duration: run.duration, heartRate: rate, sampleID: run.uuid)
    }

    func latestSleep() async throws -> SleepSummary? {
        let start = Calendar.current.date(byAdding: .day, value: -30, to: .now)
        let recent = HKQuery.predicateForSamples(withStart: start, end: .now)
        let query = HKSampleQueryDescriptor(predicates: [.categorySample(type: sleep, predicate: recent)], sortDescriptors: [])
        let samples = try await query.result(for: store)
        return SleepSummary.latest(from: samples.compactMap { sample in
            guard let stage = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return nil }
            return SleepSegment(interval: DateInterval(start: sample.startDate, end: sample.endDate), stage: stage)
        })
    }
}

#if targetEnvironment(simulator)
enum SimulatorSamples {
    static let run = RunSummary(date: .now, kilometers: 5, duration: 1_500, heartRate: 142)

    static let sleep: [SleepSegment] = {
        let calendar = Calendar.current
        let midnight = calendar.startOfDay(for: .now)
        func segment(_ start: Int, _ end: Int, _ stage: HKCategoryValueSleepAnalysis) -> SleepSegment {
            SleepSegment(interval: DateInterval(start: midnight.addingTimeInterval(Double(start) * 60),
                                                end: midnight.addingTimeInterval(Double(end) * 60)), stage: stage)
        }
        return [
            segment(-60, 420, .inBed),
            segment(-60, 60, .asleepCore),
            segment(-30, 30, .asleepUnspecified),
            segment(60, 90, .awake),
            segment(90, 270, .asleepCore),
            segment(270, 330, .asleepDeep),
            segment(330, 420, .asleepREM)
        ]
    }()
}
#endif

@main
struct HealthPreviewApp: App {
    @UIApplicationDelegateAdaptor(PhoneAppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            PreviewScreen()
                .task(id: phase) {
                    guard phase == .active else { return }
                    await MusicSharing.shared.refreshWhileActive()
                }
        }
            .onChange(of: phase, initial: true) {
                if phase == .active {
                    CoarseLocation.shared.restoreMonitoring(refresh: true)
                    Task {
                        await HealthBackground.shared.readOnForeground()
                        await BackgroundRetry.run()
                    }
                }
            }
    }
}

struct PreviewScreen: View {
    private let health = HealthReader.shared
    @State private var sampleMode = false
    @State private var busy = false
    @State private var permissionStatus = ""
    @State private var run: RunSummary?
    @State private var sleep: SleepSummary?
    @State private var runStatus = ""
    @State private var sleepStatus = ""
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Data source") {
                    #if targetEnvironment(simulator)
                    Toggle("Simulator sample data", isOn: $sampleMode)
                        .accessibilityIdentifier("sampleMode")
                        .onChange(of: sampleMode) {
                            run = nil
                            sleep = nil
                            runStatus = ""
                            sleepStatus = ""
                        }
                    #endif
                    Button("Authorize Health Access") { perform { await authorize() } }
                        .accessibilityIdentifier("authorize")
                    if !permissionStatus.isEmpty { Text(permissionStatus) }
                }
                Section("Run") {
                    Button("Preview Last Run") { perform { await previewRun() } }
                        .accessibilityIdentifier("previewRun")
                    Button("Sync Saved Run") { perform { await sync(.run) } }.disabled(sampleMode)
                    if !runStatus.isEmpty { Text(runStatus) }
                    if let run {
                        LabeledContent("Date", value: run.date.formatted(date: .abbreviated, time: .shortened))
                        LabeledContent("Distance", value: run.kilometers.map { String(format: "%.2f km", $0) } ?? "Unavailable")
                        LabeledContent("Duration", value: duration(run.duration, includeSeconds: true))
                        LabeledContent("Average pace", value: run.pace)
                        if let rate = run.heartRate {
                            LabeledContent("Average heart rate", value: "\(Int(rate.rounded())) bpm")
                        }
                    }
                }
                Section("Sleep") {
                    Button("Preview Last Sleep") { perform { await previewSleep() } }
                        .accessibilityIdentifier("previewSleep")
                    Button("Sync Last Sleep") { perform { await sync(.sleep) } }.disabled(sampleMode)
                    if !sleepStatus.isEmpty { Text(sleepStatus) }
                    if let sleep {
                        LabeledContent("Night ending", value: sleep.date.formatted(date: .abbreviated, time: .omitted))
                        LabeledContent("Total asleep", value: duration(sleep.seconds))
                        ForEach([HKCategoryValueSleepAnalysis.asleepREM, .asleepCore, .asleepDeep], id: \.self) { stage in
                            if let seconds = sleep.stages[stage] {
                                LabeledContent(stage == .asleepREM ? "REM" : stage == .asleepCore ? "Core" : "Deep",
                                               value: duration(seconds))
                            }
                        }
                    }
                }
            }
            .disabled(busy)
            .navigationTitle("Health Preview")
            .toolbar { Button("Sync Settings", systemImage: "gearshape") { showingSettings = true } }
            .sheet(isPresented: $showingSettings) { SyncSettingsView() }
        }
    }

    private func sync(_ kind: HealthSyncKind) async {
        let status: String
        do { status = try await HealthSync.manual(kind) }
        catch { status = error.localizedDescription }
        if kind == .run { runStatus = status } else { sleepStatus = status }
    }

    private func perform(_ action: @escaping @MainActor () async -> Void) {
        busy = true
        Task { @MainActor in
            defer { busy = false }
            await action()
        }
    }

    private func authorize() async {
        do {
            try await health.authorize()
            permissionStatus = "Health permission request finished. Try a preview to check for readable records."
        } catch {
            permissionStatus = "Health access request failed. \(error.localizedDescription)"
        }
    }

    private func previewRun() async {
        run = nil
        #if targetEnvironment(simulator)
        if sampleMode {
            run = SimulatorSamples.run
            runStatus = "Simulator sample · Run"
            return
        }
        #endif
        do {
            run = try await health.latestRun()
            runStatus = run == nil ? "No readable saved run. Check Health access and allow time for Watch sync." : ""
        } catch {
            runStatus = "Could not read runs. \(error.localizedDescription)"
        }
    }

    private func previewSleep() async {
        sleep = nil
        #if targetEnvironment(simulator)
        if sampleMode {
            sleep = SleepSummary.latest(from: SimulatorSamples.sleep)
            sleepStatus = "Simulator sample · Sleep"
            return
        }
        #endif
        do {
            sleep = try await health.latestSleep()
            sleepStatus = sleep == nil ? "No readable sleep in the last 30 days. Check Health access and allow time for Watch sync." : ""
        } catch {
            sleepStatus = "Could not read sleep. \(error.localizedDescription)"
        }
    }

    private func duration(_ seconds: TimeInterval, includeSeconds: Bool = false) -> String {
        let whole = Int(seconds)
        let hours = whole / 3600
        let minutes = whole / 60 % 60
        if includeSeconds {
            return hours > 0 ? "\(hours)h \(minutes)m \(whole % 60)s" : "\(minutes)m \(whole % 60)s"
        }
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }
}
