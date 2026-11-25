import Foundation

enum WorkoutKind: String, CaseIterable, Codable, Sendable {
    case running, swimming, strength, badminton
    case jumpRope = "jump_rope"
}

enum WorkoutAction: String, Codable {
    case start, pause, resume, metrics, end
}

struct WorkoutEvent: Codable {
    let source: String
    let action: WorkoutAction
    let kind: WorkoutKind?
    let at: Date
    // Decode older pending jobs so the retired Watch events can be discarded individually.
    private let sessionId: UUID?

    var belongsToRetiredCompanion: Bool { sessionId != nil || action == .metrics }

    init(action: WorkoutAction, kind: WorkoutKind?, at: Date) {
        source = "workout"
        self.action = action
        self.kind = kind
        self.at = at
        sessionId = nil
    }
}
