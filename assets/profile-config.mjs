// Public, read-only endpoint for the GitHub Pages homepage.
export const statusUrl = "https://mile-portfolio-status.thundermile.workers.dev/api/status";

// UW–Madison wall-clock times. Weekday numbers start at Sunday (0).
const fall2026 = {
  semesterStart: "2026-09-02",
  semesterEnd: "2026-12-09",
  skipDates: ["2026-09-07", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]
};
const statistics = "STAT 340 · Data Science Modeling II";

export const schedule = [
  { ...fall2026, course: "ART 428 · Digital Imaging Studio", days: [2, 4], start: "11:00", end: "13:30" },
  { ...fall2026, course: "COMP SCI 544 · Introduction to Big Data Systems", days: [1, 3, 5], start: "09:55", end: "10:45" },
  { ...fall2026, course: "COMP SCI 570 · Introduction to Human-Computer Interaction", days: [1, 3, 5], start: "12:05", end: "12:55" },
  { ...fall2026, course: statistics, days: [1, 3, 5], start: "13:20", end: "14:10" },
  { ...fall2026, course: statistics, days: [4], start: "08:50", end: "09:40" },

  { course: "COMP SCI 544 · Final exam", date: "2026-12-11", start: "14:45", end: "16:45" },
  { course: "COMP SCI 570 · Final exam", date: "2026-12-15", start: "17:05", end: "19:05" },
  { course: "STAT 340 · Final exam", date: "2026-12-17", start: "10:05", end: "12:05" }
];
