import CoreLocation
import MapKit
import SwiftUI

enum PrivateRegion: String, CaseIterable, Identifiable, Codable {
    case home = "Home"
    case school = "School"

    var id: String { rawValue }
    var radius: CLLocationDistance { self == .home ? 250 : 600 }
}

private struct RegionCenter: Codable {
    let latitude: Double
    let longitude: Double

    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
    var location: CLLocation { .init(latitude: latitude, longitude: longitude) }
}

@MainActor
final class CoarseLocation: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = CoarseLocation()

    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined
    @Published private(set) var label = ""
    @Published private(set) var message = ""
    @Published private var regions: [PrivateRegion: RegionCenter] = [:]
    private var requestedRegion: PrivateRegion?
    private var latestFix: Date = .distantPast
    private let manager = CLLocationManager()
    private var lookup: Task<Void, Never>?

    private var folder: URL { URL.applicationSupportDirectory.appending(path: "PrivateRegions", directoryHint: .isDirectory) }
    private var file: URL { folder.appending(path: "regions.json") }

    private override init() {
        super.init()
        if let data = try? Data(contentsOf: file) {
            regions = (try? JSONDecoder().decode([PrivateRegion: RegionCenter].self, from: data)) ?? [:]
        }
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        authorization = manager.authorizationStatus
        manager.delegate = self
    }

    func isConfigured(_ region: PrivateRegion) -> Bool { regions[region] != nil }

    func setRegion(_ region: PrivateRegion) {
        requestedRegion = region
        requestFix()
    }

    func requestFix() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            message = "Looking up your location…"
            manager.requestLocation()
        default:
            requestedRegion = nil
            message = "Allow location access in iPhone Settings to update the label."
        }
    }

    func requestBackgroundAccess() { manager.requestAlwaysAuthorization() }

    func restoreMonitoring(refresh: Bool = false) {
        let enabled = ActivityPreferences.origin(for: .location) != nil
        let canMonitor = enabled && manager.authorizationStatus == .authorizedAlways
        if canMonitor && CLLocationManager.significantLocationChangeMonitoringAvailable() {
            manager.startMonitoringSignificantLocationChanges()
        } else {
            manager.stopMonitoringSignificantLocationChanges()
        }
        let monitored = Dictionary(uniqueKeysWithValues: manager.monitoredRegions.map { ($0.identifier, $0) })
        for (id, region) in monitored where !canMonitor || PrivateRegion(rawValue: id).flatMap({ regions[$0] }) == nil {
            manager.stopMonitoring(for: region)
        }
        if canMonitor && CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) {
            for (region, center) in regions {
                if let previous = monitored[region.rawValue] as? CLCircularRegion,
                   previous.center.latitude == center.latitude, previous.center.longitude == center.longitude,
                   previous.radius == region.radius { continue }
                let circle = CLCircularRegion(center: center.coordinate, radius: region.radius, identifier: region.rawValue)
                manager.startMonitoring(for: circle)
            }
        }
        if enabled && refresh && [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) {
            manager.requestLocation()
        }
    }

    func setSharing(_ enabled: Bool, origin: String) async {
        ActivityPreferences.set(enabled ? origin : nil, for: .location)
        restoreMonitoring()
        if enabled {
            requestFix()
        } else {
            lookup?.cancel()
            label = ""
            message = ""
            do {
                try await UploadService.shared.clearSignal(.location, for: origin)
                await BackgroundRetry.flush()
            } catch { message = error.localizedDescription }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        restoreMonitoring(refresh: requestedRegion == nil)
        if requestedRegion != nil && [.authorizedAlways, .authorizedWhenInUse].contains(authorization) {
            requestFix()
        }
        if authorization == .denied || authorization == .restricted {
            requestedRegion = nil
            if let origin = ActivityPreferences.origin(for: .location) {
                Task {
                    await setSharing(false, origin: origin)
                    message = "Location sharing is off because access is unavailable."
                }
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) { manager.requestLocation() }
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) { manager.requestLocation() }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        requestedRegion = nil
        message = "Location is unavailable. Try again with the app open."
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last, fix.horizontalAccuracy >= 0,
              abs(fix.timestamp.timeIntervalSinceNow) < 120, fix.timestamp >= latestFix else { return }
        latestFix = fix.timestamp
        message = ""
        if let region = requestedRegion {
            requestedRegion = nil
            guard fix.horizontalAccuracy <= region.radius / 2 else {
                message = "A more accurate location is needed to set \(region.rawValue)."
                return
            }
            do {
                var updated = regions
                updated[region] = RegionCenter(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
                var directory = folder
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
                try JSONEncoder().encode(updated).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                regions = updated
                restoreMonitoring()
                message = "\(region.rawValue) region saved on this iPhone."
            } catch {
                message = "Could not save the private region."
                return
            }
        }
        lookup?.cancel()
        guard let origin = ActivityPreferences.origin(for: .location) else { return }
        lookup = Task { await publish(fix, origin: origin) }
    }

    private func publish(_ fix: CLLocation, origin: String) async {
        let closest = regions.map { (region: $0.key, distance: fix.distance(from: $0.value.location)) }
            .filter { $0.distance <= $0.region.radius }
            .min { $0.distance < $1.distance }
        let city = closest == nil ? await cityName(for: fix) : nil
        let place = closest?.region.rawValue ?? city.map { _ in "Travel" }
        guard !Task.isCancelled, ActivityPreferences.isEnabled(.location, for: origin),
              (try? await UploadService.shared.configuredOrigin()) == origin else { return }
        var signal = ActivitySignal(source: .location, action: place == nil ? "end" : "reading", at: .now)
        signal.place = place
        signal.city = city
        label = city.map { "Travel · " + $0 } ?? place ?? ""
        do {
            try await UploadService.shared.queueSignal(signal, for: origin)
            await BackgroundRetry.flush()
        } catch { message = error.localizedDescription }
        if label.isEmpty { message = "No city label available for this location." }
    }

    private func cityName(for fix: CLLocation) async -> String? {
        let approximate = CLLocation(latitude: (fix.coordinate.latitude * 100).rounded() / 100,
                                     longitude: (fix.coordinate.longitude * 100).rounded() / 100)
        if #available(iOS 26, *) {
            guard let request = MKReverseGeocodingRequest(location: approximate) else { return nil }
            return try? await request.mapItems.first?.addressRepresentations?.cityName
        }
        return try? await CLGeocoder().reverseGeocodeLocation(approximate).first?.locality
    }
}

struct LocationSharingView: View {
    let origin: String?
    @ObservedObject private var location = CoarseLocation.shared
    @State private var sharing = false

    var body: some View {
        Form {
            Section("Private regions") {
                ForEach(PrivateRegion.allCases) { region in
                    Button("Set \(region.rawValue) Here") { location.setRegion(region) }
                    if location.isConfigured(region) { Text("\(region.rawValue) region set").font(.footnote) }
                }
            }
            Section {
                Toggle("Share coarse location", isOn: Binding(get: { sharing }, set: { enabled in
                    guard let origin else { return }
                    sharing = enabled
                    Task { await location.setSharing(enabled, origin: origin) }
                })).disabled(origin == nil || location.authorization == .denied || location.authorization == .restricted)
                Button("Update Location Now") { location.requestFix() }.disabled(!sharing)
                if sharing && location.authorization == .authorizedWhenInUse {
                    Button("Allow Background Updates") { location.requestBackgroundAccess() }
                }
                if !location.label.isEmpty { LabeledContent("Label", value: location.label) }
                if !location.message.isEmpty { Text(location.message) }
            } footer: {
                Text("The backend receives Home, School or a city label. Your region coordinates stay on this iPhone.")
            }
        }
        .navigationTitle("Location Sharing")
        .task { sharing = origin.map { ActivityPreferences.isEnabled(.location, for: $0) } ?? false }
        .onChange(of: location.authorization) {
            if location.authorization == .denied || location.authorization == .restricted { sharing = false }
        }
    }
}
