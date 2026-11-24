import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, publicStatus } from "../src/state.mjs";
import { Providers } from "../src/providers.mjs";
import { scheduledClass } from "../../assets/schedule.mjs";

const base = Date.UTC(2026, 9, 10, 12);
const env = { PUBLIC_HEART_RATE: "true", MUSIC_PROVIDER: "push", VIDEO_APPS: '["A","B"]' };
function fixture() {
  const rows = {};
  const set = (source, action, offset, extra = {}) => applyEvent(rows,
    { source, action, at: new Date(base + offset).toISOString(), ...extra }, env, base + 60_000);
  const get = offset => publicStatus(rows, null, null, env, base + offset);
  return { rows, set, get };
}
test("overlaps, source-specific ends, app labels and independent music", () => {
  const { set, get } = fixture();
  set("bedtime", "start", 0);
  set("video", "start", 1, { app: "A" });
  set("video", "start", 2, { app: "B", signal: "playback" });
  set("video", "end", 3, { app: "A" });
  assert.equal(get(4).activity.label, "Watching · B");
  set("riot", "start", 5, { game: "VALORANT" });
  set("workout", "start", 6, { kind: "swimming" });
  set("music", "start", 7, { track: "Track", artist: "Artist" });
  set("video", "end", 8, { app: "B" });
  assert.equal(get(9).activity.kind, "swimming");
  assert.equal(get(9).music.track, "Track");
  set("music", "end", 10);
  assert.equal(get(10).music, null);
  set("workout", "end", 11);
  assert.equal(get(12).activity.label, "Playing · VALORANT");
  assert.equal(get(90_006).activity.kind, "bedtime");
  assert.equal(get(12 * 3600_000).activity, null);
});
test("ordering, retries, tie-breaking, elapsed vs paused active time", () => {
  const { set, get } = fixture();
  set("workout", "start", 0, { kind: "running" });
  assert.equal(set("workout", "start", 0, { kind: "running" }), false);
  assert.equal(get(1000).activity.timer.activeTime, false);
  set("workout", "pause", 4000);
  assert.equal(get(5000).activity.timer.accruedMs, 4000);
  set("workout", "resume", 9000);
  set("workout", "pause", 12000);
  assert.equal(get(13000).activity.timer.accruedMs, 7000);
  set("workout", "end", 12000);
  assert.equal(set("workout", "start", 12000, { kind: "running" }), false);
  assert.equal(set("workout", "resume", 10000), false);
  assert.equal(get(14000).activity, null);
  set("workout", "resume", 15000);
  assert.equal(set("workout", "start", 14500, { kind: "running" }), false);
});
test("sharing gates and measured-at expiry", () => {
  const { rows, set, get } = fixture();
  assert.throws(() => set("video", "start", 0, { app: "private" }));
  assert.throws(() => set("riot", "start", 1, { game: "Riot Client" }));
  set("workout", "start", 10, { kind: "badminton" });
  set("heart", "reading", 9, { bpm: 120 });
  assert.equal(get(20).heart, null);
  set("heart", "reading", 20, { bpm: 120 });
  assert.equal(get(30).heart.bpm, 120);
  assert.equal(get(60_020).heart, null);
  assert.equal(publicStatus(rows, null, null, { ...env, PUBLIC_HEART_RATE: "false" }, base + 30).heart, null);
  set("music", "start", 2, { track: "Track", artist: "Artist" });
  assert.equal(get(90_002).music, null);
});
test("Chicago class wall-clock boundaries, semesters, DST and overnight entries", () => {
  const entry = { course: "Test", days: [1], start: "09:00", end: "10:00",
    semesterStart: "2026-01-01", semesterEnd: "2026-12-31" };
  const at = (iso, e = entry) => scheduledClass([e], Date.parse(iso));
  assert.equal(at("2026-03-02T15:00Z").kind, "class");
  assert.equal(at("2026-03-09T14:00Z").kind, "class");
  assert.equal(at("2026-03-09T15:00Z"), null);
  assert.equal(at("2026-11-02T15:00Z").kind, "class");
  assert.equal(at("2027-01-04T15:00Z"), null);
  assert.equal(at("2026-03-10T05:15Z", { ...entry, start: "23:30", end: "00:30" }).kind, "class");
  assert.equal(scheduledClass([], Date.now()), null);
});
test("Steam and Spotify polling, simultaneous requests, stop, and token rotation", async () => {
  let time = base, playing = true, calls = 0;
  const storage = new Map();
  const store = { get: k => storage.get(k), put: (k,v) => storage.set(k,v) };
  const config = { STEAM_ID64: "76561198000000000", STEAM_API_KEY: "fixture", MUSIC_PROVIDER: "spotify",
    SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "test", SPOTIFY_REFRESH_TOKEN: "initial" };
  const request = async (url, init) => {
    calls++;
    if (String(url).includes("GetPlayerSummaries")) return Response.json({ response: { players: [
      { steamid: config.STEAM_ID64, personastate: 1, ...(playing ? { gameid: "123", gameextrainfo: "Sample" } : {}) }
    ] } });
    if (String(url).includes("IStoreBrowseService")) return Response.json({ response: { store_items: [] } });
    if (String(url).includes("api/token")) {
      assert.equal(init.body.get("refresh_token"), "initial");
      return Response.json({ access_token: "test", refresh_token: "rotated", expires_in: 3600 });
    }
    if (!playing) return new Response(null, { status: 204 });
    return Response.json({ is_playing: true, currently_playing_type: "track", progress_ms: 2000,
      item: { name: "Sample", artists: [{ name: "Artist" }], duration_ms: 3100 } });
  };
  const providers = new Providers(config, store, request, () => time);
  const [game,,music] = await Promise.all([providers.steam(), providers.steam(), providers.spotify()]);
  assert.equal(calls, 4); assert.equal(game.label, "Playing · Sample");
  assert.equal(music.expiresAt, base + 1100);
  assert.equal(storage.get("spotify-rotation").value, "rotated");
  playing = false; time += 21_000;
  assert.equal(await providers.steam(), null); assert.equal(await providers.spotify(), null);
  assert.equal(new Providers({}, store).spotify(), null);
});
test("provider failures retain a finite TTL and honor rate-limit backoff", async () => {
  let time = base, calls = 0;
  const config = { STEAM_ID64: "76561198000000000", STEAM_API_KEY: "fixture" };
  const request = async url => {
    if (String(url).includes("IStoreBrowseService")) return Response.json({ response: { store_items: [] } });
    if (++calls > 1) return new Response(null, { status: 429, headers: { "retry-after": "60" } });
    return Response.json({ response: { players: [{ steamid: config.STEAM_ID64, gameid: "1", gameextrainfo: "Demo" }] } });
  };
  const p = new Providers(config, {}, request, () => time);
  await p.steam(); time += 21_000;
  const stale = await p.steam(); time += 40_000;
  assert.equal(publicStatus({}, stale, null, env, time).activity, null);
  await p.steam(); assert.equal(calls, 2);
});

test("Discord Playing titles, source precedence, cache, expiry and successful clear", async () => {
  const id = "123456789012345678";
  let time = base, calls = 0, unavailable = false;
  let activities = [
    { type: 2, name: "Music" }, { type: 4, name: "Custom Status" },
    { type: 0, name: "  " }, { type: 0, name: "Puzzle game", details: "Private session detail" }
  ];
  const providers = new Providers({ LANYARD_USER_ID: id }, {}, async url => {
    assert.equal(url, "https://api.lanyard.rest/v1/users/" + id);
    calls++;
    if (unavailable) return new Response(null, { status: 503 });
    return Response.json({ success: true, data: { activities, discord_user: { id } } });
  }, () => time);
  const { rows, set } = fixture();
  const read = async () => publicStatus(rows, null, null, env, time, await providers.discord()).activity;
  set("video", "start", 0, { app: "A" });
  assert.deepEqual(await read(), { kind: "gaming", label: "Playing · Puzzle game", expiresAt: base + 30_000 });
  set("workout", "start", 1, { kind: "running" });
  time += 1;
  assert.equal((await read()).kind, "running");
  set("workout", "end", 2);
  time += 1;
  assert.equal((await read()).label, "Playing · Puzzle game");
  assert.equal(calls, 1);
  unavailable = true;
  time += 8000;
  assert.equal((await read()).label, "Playing · Puzzle game");
  time = base + 30_000;
  assert.equal((await read()).label, "On A");
  unavailable = false;
  activities = [{ type: 0, name: "Another game" }];
  time += 8000;
  assert.equal((await read()).label, "Playing · Another game");
  activities = [{ type: 3, name: "Watching a stream" }];
  time += 8000;
  assert.equal((await read()).label, "On A");
  assert.equal(await providers.discord(), null);
});
