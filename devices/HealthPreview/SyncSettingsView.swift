import SwiftUI

struct SyncSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    #if targetEnvironment(simulator)
    @State private var url = "http://127.0.0.1:8768"
    #else
    @State private var url = "https://mile-portfolio-status.thundermile.workers.dev"
    #endif
    @State private var token = ""
    @State private var origin: String?
    @State private var pending = 0
    @State private var status = ""
    @State private var busy = false
    @State private var heart = false
    @State private var stage = false
    @State private var music = false
    @State private var autoRun = false
    @State private var autoSleep = false
    @ObservedObject private var musicSharing = MusicSharing.shared
    private let uploads = UploadService.shared

    var body: some View {
        NavigationStack {
            Form {
                Section("Backend") {
                    TextField("Backend URL", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Write Token", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Save Backend") { perform {
                        try await uploads.configure(origin: url, token: token)
                        token = ""
                        status = "Backend saved in Keychain."
                        await musicSharing.refresh()
                    } }
                    if let origin { LabeledContent("Active backend", value: origin) }
                    Button("Retry Pending Uploads") { perform {
                        try await uploads.flush(force: true)
                        status = "Checked pending uploads."
                    } }.disabled(origin == nil)
                    if origin != nil { LabeledContent("Pending uploads", value: String(pending)) }
                    if !status.isEmpty { Text(status) }
                }
                Section("Public activity") {
                    Toggle("Share Apple Music", isOn: Binding(get: { music }, set: { enabled in
                        guard let origin else { return }
                        perform { try await musicSharing.setSharing(enabled, for: origin) }
                    })).disabled(origin == nil)
                    if origin != nil { Text(musicSharing.status).font(.footnote) }
                    sharingToggle("Share heart rate", source: .heart, state: $heart)
                    sharingToggle("Share observed sleep stages", source: .sleepStage, state: $stage)
                    Text("The backend must also enable each public sharing setting.").font(.footnote)
                    NavigationLink("Location Sharing") { LocationSharingView(origin: origin) }
                }
                #if !targetEnvironment(simulator)
                Section("Private summaries") {
                    automaticToggle("Sync saved runs in background", kind: .run, state: $autoRun)
                    automaticToggle("Sync last sleep in background", kind: .sleep, state: $autoSleep)
                }
                #if DEBUG
                Section("Development") {
                    if origin?.hasPrefix("http://") == true {
                        Button("Check Local Backend") { perform {
                            try await uploads.checkLocalPreview()
                            status = "The local backend accepted the test request."
                        } }
                        if !status.isEmpty { Text(status) }
                    }
                    NavigationLink("Health Delivery Timing") { HealthDeliveryDiagnosticsView() }
                }
                #endif
                #else
                Section("Simulator") {
                    Text("The simulator can send only to a local test backend.")
                    Button("Start Workout · Running") { perform {
                        status = try await StartWorkoutIntent(kind: .running).perform().value ?? ""
                    } }
                    Button("End Workout") { perform {
                        status = try await EndWorkoutIntent().perform().value ?? ""
                    } }
                }
                #endif
            }
            .disabled(busy)
            .navigationTitle("Sync Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await reload() }
        }
    }

    private func sharingToggle(_ title: String, source: ActivitySource, state: Binding<Bool>) -> some View {
        Toggle(title, isOn: Binding(get: { state.wrappedValue }, set: { enabled in
            guard let origin else { return }
            perform {
                if enabled {
                    #if !targetEnvironment(simulator)
                    try await HealthReader.shared.authorize()
                    #endif
                    ActivityPreferences.set(origin, for: source)
                } else {
                    ActivityPreferences.set(nil, for: source)
                    try await uploads.clearSignal(source, for: origin)
                }
                try await HealthBackground.shared.updateRegistration()
                if enabled { await HealthBackground.shared.readOnForeground() }
                await BackgroundRetry.flush()
            }
        })).disabled(origin == nil)
    }

    private func automaticToggle(_ title: String, kind: HealthSyncKind, state: Binding<Bool>) -> some View {
        Toggle(title, isOn: Binding(get: { state.wrappedValue }, set: { enabled in
            guard let origin else { return }
            perform {
                if enabled {
                    try await HealthReader.shared.authorize()
                    HealthSyncPreferences.set(origin, for: kind)
                } else {
                    HealthSyncPreferences.set(nil, for: kind)
                    try await uploads.stopAutomatic(kind)
                }
                try await HealthBackground.shared.updateRegistration()
            }
        })).disabled(origin == nil)
    }

    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                try await action()
                await BackgroundRetry.schedule()
            } catch {
                status = error.localizedDescription
            }
            await reload()
        }
    }

    private func reload() async {
        do {
            origin = try await uploads.configuredOrigin()
            pending = try await uploads.pendingCount()
            if let origin { url = origin }
            heart = ActivityPreferences.origin(for: .heart) == origin && origin != nil
            stage = ActivityPreferences.origin(for: .sleepStage) == origin && origin != nil
            music = ActivityPreferences.origin(for: .music) == origin && origin != nil
            autoRun = HealthSyncPreferences.origin(for: .run) == origin && origin != nil
            autoSleep = HealthSyncPreferences.origin(for: .sleep) == origin && origin != nil
        } catch { status = error.localizedDescription }
    }
}
