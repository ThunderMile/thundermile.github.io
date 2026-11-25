import XCTest

final class HealthPreviewUITests: XCTestCase {
    #if targetEnvironment(simulator)
    func testEmptyStoreThenSimulatorSamples() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        app.buttons["authorize"].tap()
        finishHealthAuthorization(in: app)
        assertText(in: app, beginningWith: "Health permission request finished")
        app.buttons["previewRun"].tap()
        assertText(in: app, beginningWith: "No readable saved run")
        app.buttons["previewSleep"].tap()
        assertText(in: app, beginningWith: "No readable sleep")

        app.switches["sampleMode"].switches.firstMatch.tap()
        app.buttons["previewRun"].tap()
        assertText(in: app, beginningWith: "Simulator sample · Run")
        assertMetric("Distance", value: "5.00 km", in: app)
        assertMetric("Duration", value: "25m 0s", in: app)
        assertMetric("Average pace", value: "5:00 min/km", in: app)
        if !app.buttons["previewSleep"].isHittable { app.swipeUp() }
        app.buttons["previewSleep"].tap()
        app.swipeUp()
        assertText(in: app, beginningWith: "Simulator sample · Sleep")
        assertMetric("Total asleep", value: "7h 30m", in: app)
        assertMetric("REM", value: "1h 30m", in: app)
        assertMetric("Core", value: "5h 0m", in: app)
        assertMetric("Deep", value: "1h 0m", in: app)
    }

    private func finishHealthAuthorization(in app: XCUIApplication) {
        let allCategories = app.cells["UIA.Health.AuthSheet.AllCategoryButton"]
        if allCategories.waitForExistence(timeout: 3) {
            allCategories.tap()
            let next = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Continue")).firstMatch
            if !next.isHittable { app.swipeUp() }
            next.tap()

            let recentData = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Past 30 Days and Future Data")).firstMatch
            XCTAssertTrue(recentData.waitForExistence(timeout: 5))
            recentData.tap()
            app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Allow")).firstMatch.tap()
        } else if app.buttons["Turn On All"].exists {
            app.buttons["Turn On All"].tap()
            app.buttons["Allow"].tap()
        }
    }

    private func assertText(in app: XCUIApplication, beginningWith prefix: String, file: StaticString = #filePath, line: UInt = #line) {
        let text = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5), "Missing text beginning with \(prefix)", file: file, line: line)
    }

    private func assertMetric(_ label: String, value: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let combined = NSPredicate(
            format: "(label == %@ AND value == %@) OR (label CONTAINS %@ AND label CONTAINS %@)",
            label, value, label, value
        )
        let metric = app.descendants(matching: .any).matching(combined).firstMatch
        if !app.staticTexts[value].exists && !metric.waitForExistence(timeout: 3) {
            let relevantRows = app.debugDescription.split(separator: "\n").filter { $0.contains(label) }
            XCTFail("Expected \(label) to be \(value). Found \(relevantRows)", file: file, line: line)
        }
    }
    #endif
}
