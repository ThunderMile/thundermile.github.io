import Combine
import Foundation
import MediaPlayer

@MainActor
final class MusicSharing: ObservableObject {
    static let shared = MusicSharing()
    nonisolated static let lifetime: TimeInterval = 90
    private static let refreshInterval: TimeInterval = 30

    @Published private(set) var status = "Music sharing is off."

    private struct Track: Equatable {
        let title: String
        let artist: String?
    }

    private struct Observation {
        let origin: String
        let track: Track?
        let at: Date
    }

    private let uploads = UploadService.shared
    private var player: MPMusicPlayerController?
    private var subscriptions: Set<AnyCancellable> = []
    private var previous: Observation?

    func setSharing(_ enabled: Bool, for origin: String) async throws {
        if enabled {
            guard await MPMediaLibrary.requestAuthorization() == .authorized else {
                status = "Allow Media & Apple Music access in iPhone Settings."
                return
            }
            ActivityPreferences.set(origin, for: .music)
            await refresh()
        } else {
            ActivityPreferences.set(nil, for: .music)
            stopObserving()
            status = "Music sharing is off."
            try await uploads.clearSignal(.music, for: origin)
            await BackgroundRetry.flush()
        }
    }

    func refreshWhileActive() async {
        while !Task.isCancelled {
            await refresh()
            do { try await Task.sleep(for: .seconds(Self.refreshInterval)) }
            catch { return }
        }
    }

    func refresh() async {
        do {
            guard let origin = ActivityPreferences.origin(for: .music),
                  try await uploads.configuredOrigin() == origin,
                  ActivityPreferences.isEnabled(.music, for: origin) else {
                stopObserving()
                status = "Music sharing is off."
                return
            }

            let track: Track?
            if MPMediaLibrary.authorizationStatus() == .authorized {
                let player = observePlayback()
                if player.playbackState == .playing {
                    let item = player.nowPlayingItem
                    track = Self.label(item?.title).flatMap { title in
                        guard !["itunes media", "no items"].contains(title.lowercased()) else { return nil }
                        return Track(title: title, artist: Self.label(item?.artist))
                    }
                    status = track == nil ? "Music has no readable song title." : "A song is playing."
                } else {
                    track = nil
                    status = "Music is paused or stopped."
                }
            } else {
                if player != nil { stopObserving() }
                track = nil
                status = "Allow Media & Apple Music access in iPhone Settings."
            }

            let now = Date.now
            if let previous, previous.origin == origin, previous.track == track,
               track == nil || now.timeIntervalSince(previous.at) < Self.refreshInterval { return }

            var signal = ActivitySignal(source: .music, action: track == nil ? "end" : "start", at: now)
            signal.track = track?.title
            signal.artist = track?.artist
            previous = Observation(origin: origin, track: track, at: now)
            do {
                try await uploads.queueSignal(signal, for: origin)
            } catch {
                if previous?.at == now { previous = nil }
                throw error
            }
            await BackgroundRetry.flush()
        } catch {
            status = error.localizedDescription
        }
    }

    private func observePlayback() -> MPMusicPlayerController {
        if let player { return player }
        let player = MPMusicPlayerController.systemMusicPlayer
        self.player = player
        for name in [Notification.Name.MPMusicPlayerControllerPlaybackStateDidChange,
                     .MPMusicPlayerControllerNowPlayingItemDidChange] {
            NotificationCenter.default.publisher(for: name, object: player)
                .sink { [weak self] _ in Task { @MainActor in await self?.refresh() } }
                .store(in: &subscriptions)
        }
        player.beginGeneratingPlaybackNotifications()
        return player
    }

    private func stopObserving() {
        subscriptions.removeAll()
        player?.endGeneratingPlaybackNotifications()
        player = nil
        previous = nil
    }

    private static func label(_ input: String?) -> String? {
        guard var text = input?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
              !text.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { return nil }
        while text.utf16.count > 120 { text.removeLast() }
        return text.isEmpty ? nil : text
    }
}
