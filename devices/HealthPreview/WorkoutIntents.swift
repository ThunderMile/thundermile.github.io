import AppIntents
import Foundation

extension WorkoutKind: AppEnum {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Workout Type"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .running: "Running",
        .swimming: "Swimming",
        .strength: "Strength Training",
        .jumpRope: "Jump Rope",
        .badminton: "Badminton"
    ]
}

struct StartWorkoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Workout"
    static let description = IntentDescription("Send the selected workout start to your configured backend.")
    static let openAppWhenRun = false

    @Parameter(title: "Workout Type")
    var kind: WorkoutKind

    static var parameterSummary: some ParameterSummary {
        Summary("Start Workout (\(\.$kind))")
    }

    init() {}
    init(kind: WorkoutKind) { self.kind = kind }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let result = try await UploadService.shared.sendWorkout(.start, kind: kind)
        return .result(value: result.message, dialog: "\(result.message)")
    }
}

struct EndWorkoutIntent: AppIntent {
    static let title: LocalizedStringResource = "End Workout"
    static let description = IntentDescription("Clear the workout status on your configured backend.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let result = try await UploadService.shared.sendWorkout(.end)
        return .result(value: result.message, dialog: "\(result.message)")
    }
}

struct SyncSavedRunIntent: AppIntent {
    static let title: LocalizedStringResource = "Sync Saved Run"
    static let description = IntentDescription("Upload the latest readable saved run summary.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let message = try await HealthSync.manual(.run)
        return .result(value: message, dialog: "\(message)")
    }
}

struct SyncLastSleepIntent: AppIntent {
    static let title: LocalizedStringResource = "Sync Last Sleep"
    static let description = IntentDescription("Upload the latest readable night's total sleep duration.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let message = try await HealthSync.manual(.sleep)
        return .result(value: message, dialog: "\(message)")
    }
}

struct StartBedtimeIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Bedtime"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let result = try await UploadService.shared.sendActivity(.bedtime, .start)
        return .result(dialog: "\(result.message)")
    }
}

struct EndBedtimeIntent: AppIntent {
    static let title: LocalizedStringResource = "End Bedtime"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let result = try await UploadService.shared.sendActivity(.bedtime, .end)
        return .result(dialog: "\(result.message)")
    }
}

struct SetBilibiliPresenceIntent: AppIntent {
    static let title: LocalizedStringResource = "Set Bilibili Presence"
    static let description = IntentDescription("Update the homepage when you open or leave Bilibili.")
    static let openAppWhenRun = false

    @Parameter(title: "App Is Open")
    var isOpen: Bool

    static var parameterSummary: some ParameterSummary { Summary("Set Bilibili Presence (\(\.$isOpen))") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let result = try await UploadService.shared.sendActivity(.video, isOpen ? .start : .end, app: "Bilibili")
        return .result(dialog: "\(result.message)")
    }
}
