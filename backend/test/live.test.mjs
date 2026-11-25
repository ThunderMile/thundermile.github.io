import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, publicStatus } from "../src/state.mjs";
import { saveHealthSummary } from "../src/health.mjs";
import { bedtimeLine, heartAt, lastUpdateLine, musicLine, sleepObservation, workoutLine } from "../../assets/activity-display.mjs";

const base = Date.parse("2026-11-24T04:00:00Z");
const iso = offset => new Date(base + offset).toISOString();
const env = { PUBLIC_HEART_RATE: "true", PUBLIC_SLEEP_STAGE: "true", MUSIC_PROVIDER: "push" };
function fixture() {
  const rows = {};
  const send = (source, action, offset, extra = {}) =>
    applyEvent(rows, { source, action, at: iso(offset), ...extra }, env, base + offset);
  const status = (offset, options = env) => publicStatus(rows, null, null, options, base + offset);
  return { rows, send, status };
}

test("Apple Music observations render beside activity, clear and expire at the source timestamp", () => {
  const { send, status } = fixture();
  const line = at => musicLine(status(at).music, base + at);
  send("workout", "start", 0, { kind: "running" });
  assert.throws(() => send("music", "start", 1, { track: "iTunes Media" }));
  assert.throws(() => send("music", "start", 2, { track: "No Items" }));
  assert.throws(() => send("music", "start", 3, {}));
  assert.equal(line(3), "");

  send("music", "start", 1000, { track: "First fixture song", artist: "Fixture artist" });
  assert.equal(status(1500).activity.label, "Running");
  assert.equal(line(1500), "♪ First fixture song — Fixture artist");
  send("music", "start", 2000, { track: "Second fixture song" });
  assert.equal(line(2100), "♪ Second fixture song");
  assert.equal(status(2100, { ...env, MUSIC_PROVIDER: "off" }).music, null);
  send("music", "end", 3000);
  assert.equal(line(3100), "");
  assert.equal(send("music", "start", 4000, { at: iso(2000), track: "Delayed fixture song" }), false);
  assert.equal(line(4000), "");

  send("music", "start", 5000, { track: "Second fixture song" });
  send("music", "start", 35000, { track: "Second fixture song" });
  const snapshot = status(36000).music;
  assert.equal(snapshot.expiresAt, base + 125000);
  assert.equal(musicLine(snapshot, base + 124999), "♪ Second fixture song");
  assert.equal(musicLine(snapshot, base + 125000), "");
  assert.equal(line(125000), "");
  assert.equal(send("music", "start", 130000, { at: iso(39000), track: "Expired fixture song" }), false);
  assert.equal(line(130000), "");
});

test("native Workout Shortcut starts the requested fox and elapsed timer, then restores gaming", () => {
  const { send, status } = fixture();
  send("riot", "start", 0, { game: "VALORANT" });
  assert.equal(send("workout", "start", 5000, { kind: "running", at: "2026-11-23T22:00:01-06:00" }), true);
  const activity = status(6000).activity;
  assert.equal(activity.kind, "running");
  assert.equal(activity.label, "Running");
  assert.equal(activity.timer.startedAt, base + 1000);
  assert.equal(workoutLine(activity.timer, base + 6000), "Since start 00:05");
  assert.equal(workoutLine(activity.timer, base + 8000), "Since start 00:07");
  assert.equal(lastUpdateLine(status(8000).lastUpdatedAt, base + 8000), "Last update 7s ago");
  assert.equal(lastUpdateLine(status(61_000).lastUpdatedAt, base + 61_000), "Last update 1m ago");
  assert.equal(activity.distance, undefined);
  assert.equal(send("workout", "end", 9000), true);
  assert.equal(status(10_000).activity.label, "Playing · VALORANT");
  assert.equal(lastUpdateLine(status(10_000).lastUpdatedAt, base + 10_000), "Last update 1s ago");
});

test("retired companion rows and packets cannot override native Workout Shortcut events", () => {
  const { rows, send, status } = fixture();
  const sessionId = "822c4aa9-7d78-4f45-9e55-3638d470e7ca";
  rows.workout = { sessionId, at: base + 5000, expiresAt: base + 60_000, label: "Running", kind: "running" };
  assert.equal(status(6000).activity, null);
  assert.equal(send("workout", "start", 6000, { kind: "strength", at: iso(4000) }), true);
  assert.equal(send("workout", "end", 7000, { sessionId }), false);
  assert.equal(status(8000).activity.kind, "strength");
  assert.equal(send("workout", "end", 9000), true);
  assert.equal(send("workout", "start", 10_000, { sessionId, kind: "running" }), false);
  assert.equal(send("workout", "metrics", 11_000, { sessionId }), false);
  assert.equal(status(12_000).activity, null);
});

test("heart samples retain the original measured-at time across mode switches, replays and expiry", () => {
  const { send, status } = fixture();
  assert.equal(heartAt(status(0).heart, base), null);
  assert.throws(() => send("heart", "reading", 0, { bpm: 99 }), /ISO 8601/);
  send("heart", "reading", 0, { bpm: 99, measuredAt: iso(-21 * 60_000) });
  assert.equal(status(0).heart, null);
  send("heart", "reading", 0, { bpm: 99, measuredAt: iso(-3 * 60_000) });
  assert.equal(heartAt(status(0).heart, base).expiresAt, base + 17 * 60_000);
  send("workout", "start", 1000, { kind: "running" });
  send("heart", "reading", 2000, { bpm: 148, measuredAt: iso(1800) });
  const fresh = status(2200).heart;
  assert.equal(fresh.measuredAt, base + 1800);
  const expiry = base + 1800 + 20 * 60_000;
  assert.equal(fresh.expiresAt, expiry);
  assert.equal(status(2200).lastUpdatedAt, fresh.measuredAt);
  assert.equal(heartAt(fresh, base + 2200).bpm, 148);
  assert.equal(send("heart", "reading", 20_000, { bpm: 99, measuredAt: iso(1700) }), false);
  assert.equal(send("heart", "reading", 40_000, { bpm: 148, measuredAt: iso(1800) }), false);
  send("riot", "start", 40_000, { game: "VALORANT" });
  send("workout", "end", 41_000);
  assert.equal(status(42_000).activity.kind, "gaming");
  assert.equal(status(42_000).heart.bpm, 148);
  assert.equal(status(42_000).lastUpdatedAt, base + 41_000);
  assert.equal(status(61_800).heart.expiresAt, expiry);
  assert.equal(heartAt(fresh, expiry - 1), fresh);
  assert.equal(heartAt(fresh, expiry), null);
  assert.equal(status(expiry).heart, null);
  assert.equal(JSON.stringify(status(43_000, { ...env, PUBLIC_HEART_RATE: "false" })).includes("bpm"), false);
  send("heart", "end", 46_000);
  assert.equal(status(46_000).heart, null);
  assert.equal(send("heart", "reading", 49_000, { bpm: 148, measuredAt: iso(45_000) }), false);
});

test("a shared heart reading dates the last update from measurement through expiry", () => {
  const { send, status } = fixture();
  const measured = -16 * 60_000;
  send("heart", "reading", 0, { bpm: 80, measuredAt: iso(measured) });
  assert.equal(status(0).heart.bpm, 80);
  assert.equal(lastUpdateLine(status(0).lastUpdatedAt, base), "Last update 16m ago");
  const expires = 4 * 60_000;
  assert.equal(status(expires).heart, null);
  assert.equal(status(expires).lastUpdatedAt, base + measured);
  assert.equal(status(expires, { ...env, PUBLIC_HEART_RATE: "false" }).lastUpdatedAt, undefined);
  send("heart", "end", expires + 1000);
  assert.equal(status(expires + 1000).lastUpdatedAt, undefined);
});

test("bedtime elapsed begins at Focus while an observed stage has its own interval", () => {
  const { send, status } = fixture();
  send("bedtime", "start", 0);
  const now = (3 * 60 + 34) * 60_000;
  assert.match(bedtimeLine(status(now).activity.startedAt, base + now), /since 10:00\sPM · 3h 34m elapsed/);
  send("sleep_stage", "reading", now, { stage: "REM", startedAt: iso(now - 120_000), endedAt: iso(now - 60_000) });
  const observation = status(now).sleepStage;
  assert.match(sleepObservation(observation, base + now), /^Observed REM .+1m ago$/);
  assert.equal(status(now, { ...env, PUBLIC_SLEEP_STAGE: "false" }).sleepStage, undefined);
  assert.equal(sleepObservation(observation, observation.expiresAt), "");
  assert.equal(status(now + 60_000).sleepStage, undefined);
  send("sleep_stage", "reading", now + 600_000, {
    stage: "Core", startedAt: iso(now - 60_000), endedAt: iso(now)
  });
  assert.equal(status(now + 600_000).sleepStage, undefined);
});

test("coarse location is independent of activity, skips out-of-order updates and expires", () => {
  const { rows, send, status } = fixture();
  send("workout", "start", 0, { kind: "running" });
  send("location", "reading", 1000, { place: "School", coordinates: [1, 2] });
  assert.equal(status(2000).activity.kind, "running");
  assert.deepEqual(status(2000).location, { label: "School", expiresAt: base + 86_401_000 });
  assert.equal(rows.location.coordinates, undefined);
  assert.equal(send("location", "reading", 500, { place: "Home" }), false);
  send("location", "reading", 3000, { place: "Travel", city: "Madison" });
  assert.equal(status(4000).location.label, "Travel · Madison");
  assert.equal(status(86_403_000).location, undefined);
  send("location", "end", 5000);
  assert.equal(status(6000).location, undefined);
});

test("private summary retries deduplicate and late revisions cannot overwrite a newer night", async () => {
  const records = new Map();
  const storage = { get: key => records.get(key), put: (key, value) => records.set(key, value) };
  const summary = { kind: "sleep", id: "2026-11-24", durationSeconds: 27_000 };
  const save = (offset, detail) => saveHealthSummary(storage, { at: iso(offset), summary: detail }, base + 4000);
  assert.equal(await save(1000, summary), true);
  assert.equal(await save(1000, summary), false);
  assert.equal(await save(3000, summary), false);
  assert.equal(await save(2000, { ...summary, durationSeconds: 26_000 }), false);
  assert.equal(await save(4000, { ...summary, durationSeconds: 28_000, stages: ["private"] }), true);
  assert.deepEqual(storage.get("health:sleep:2026-11-24").summary, { ...summary, durationSeconds: 28_000 });
});
