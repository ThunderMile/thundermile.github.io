import UIKit
import OSLog

final class PhoneAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BackgroundRetry.register()
        HealthBackground.shared.installEnabledObservers()
        CoarseLocation.shared.restoreMonitoring()
        #if targetEnvironment(simulator)
        let env = ProcessInfo.processInfo.environment
        if let token = env["PORTFOLIO_SIMULATOR_TOKEN"] {
            let origin = env["PORTFOLIO_SIMULATOR_URL"] ?? "http://127.0.0.1:8768"
            Task {
                do {
                    try await UploadService.shared.configure(origin: origin, token: token)
                    if env["PORTFOLIO_SIMULATOR_HEART"] == "true" { ActivityPreferences.set(origin, for: .heart) }
                } catch {
                    Logger(subsystem: "io.github.thundermile.HealthPreview", category: "Simulator").error("Could not configure the local preview backend.")
                }
            }
        }
        #elseif DEBUG
        let env = ProcessInfo.processInfo.environment
        if let url = env["PORTFOLIO_DEVICE_URL"], url.hasPrefix("http://"),
           let token = env["PORTFOLIO_DEVICE_TOKEN"], token.hasPrefix("device-preview-") {
            Task {
                do { try await UploadService.shared.configure(origin: url, token: token) }
                catch {
                    Logger(subsystem: "io.github.thundermile.HealthPreview", category: "DevicePreview").error("Could not configure the device preview backend.")
                }
            }
        }
        #endif
        return true
    }
}
