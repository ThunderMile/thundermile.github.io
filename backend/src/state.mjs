const minute = 60_000;
export const workoutLabels = {
  running: "Running", swimming: "Swimming", strength: "Strength training",
  jump_rope: "Jumping rope", badminton: "Badminton"
};
const lifetimes = { workout: 360 * minute, riot: 90_000, video: 90 * minute,
  bedtime: 720 * minute, heart: minute, music: 90_000 };
const riotTitles = ["League of Legends", "VALORANT"];
const fresh = (item, now) => item && item.expiresAt > now;

export class EventError extends Error {}
function requireValue(condition, message) {
  if (!condition) throw new EventError(message);
}
function cleanText(value) {
  requireValue(typeof value === "string" && value.trim().length > 0 &&
    value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value), "Expected a short, nonempty label.");
  return value.trim();
}
export function allowedApps(env) {
  const apps = JSON.parse(env.VIDEO_APPS || "[]");
  return Array.isArray(apps) ? apps.filter(value => typeof value === "string") : [];
}

// Keep each last accepted timestamp, including after an end or natural expiry.
export function applyEvent(rows, input, env, now) {
  requireValue(input && typeof input === "object" && !Array.isArray(input), "Expected an event object.");
  const { source, action } = input;
  requireValue(Object.hasOwn(lifetimes, source), "Unknown source.");
  requireValue(typeof input.at === "string" && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(input.at),
    "at must be an ISO 8601 timestamp with a timezone.");
  const at = Date.parse(input.at);
  requireValue(Number.isFinite(at) && at <= now + 60_000, "Invalid or future timestamp.");
  const permitted = source === "workout" ? ["start", "pause", "resume", "end"] :
    source === "heart" ? ["reading", "end"] : ["start", "end"];
  requireValue(permitted.includes(action), "Unknown action for this source.");
  let key = source;
  if (source === "video") {
    requireValue(allowedApps(env).includes(input.app), "App is outside the sharing allowlist.");
    key = "video:" + input.app;
  }
  if (source === "heart") requireValue(env.PUBLIC_HEART_RATE === "true", "Heart-rate sharing is disabled.");
  if (source === "music") requireValue(env.MUSIC_PROVIDER === "push", "Pushed music is disabled.");
  const prev = rows[key];
  if (prev && (at < prev.at || (at === prev.at && (action !== "end" || prev.action === "end")))) return false;
  const next = { at, action, expiresAt: at + lifetimes[source] };
  if (action === "end") {
    rows[key] = { at, action, expiresAt: 0 };
    return true;
  }
  switch (source) {
    case "workout": {
      if (action === "start") {
        requireValue(Object.hasOwn(workoutLabels, input.kind), "Unknown workout kind.");
        Object.assign(next, { kind: input.kind, label: workoutLabels[input.kind],
          timer: { startedAt: at, since: at, accruedMs: 0, paused: false, activeTime: false } });
      } else {
        if (!fresh(prev, at) || !prev.timer) {
          rows[key] = { at, action, expiresAt: 0 };
          return true;
        }
        if (prev.timer.paused === (action === "pause")) {
          rows[key] = { ...prev, at, action };
          return true;
        }
        const timer = { ...prev.timer, activeTime: true, since: at, paused: action === "pause" };
        if (timer.paused) timer.accruedMs += at - prev.timer.since;
        Object.assign(next, { kind: prev.kind, label: prev.label, timer });
      }
      break;
    }
    case "riot":
      requireValue(riotTitles.includes(input.game), "Unknown Riot game.");
      Object.assign(next, { kind: "gaming", label: "Playing · " + input.game });
      break;
    case "video":
      requireValue(input.signal === undefined || ["open", "playback"].includes(input.signal), "Unknown app signal.");
      Object.assign(next, { kind: "video", label: (input.signal === "playback" ? "Watching · " : "On ") + input.app });
      break;
    case "bedtime": Object.assign(next, { kind: "bedtime", label: "Bedtime" }); break;
    case "heart":
      requireValue(Number.isInteger(input.bpm) && input.bpm > 0 && input.bpm <= 300, "Expected integer bpm from 1 to 300.");
      next.bpm = input.bpm;
      if (input.workoutStartedAt !== undefined) {
        requireValue(Number.isSafeInteger(input.workoutStartedAt), "Expected the workout start in epoch milliseconds.");
        next.workoutStartedAt = input.workoutStartedAt;
      }
      break;
    case "music": Object.assign(next, { track: cleanText(input.track), artist: cleanText(input.artist) }); break;
  }
  rows[key] = next;
  return true;
}

export function publicStatus(rows, steam, spotify, env, now, discord = null) {
  const apps = allowedApps(env).map(app => rows["video:" + app]).filter(item => fresh(item, now));
  apps.sort((a, b) => b.at - a.at);
  const main = [rows.workout, discord, rows.riot, steam, apps[0], rows.bedtime].find(item => fresh(item, now));
  const activity = main ? { kind: main.kind, label: main.label, expiresAt: main.expiresAt } : null;
  if (main?.timer) activity.timer = main.timer;
  if (main?.kind === "gaming" && main.icon) activity.icon = main.icon;
  const beat = rows.heart;
  const heart = activity?.timer && env.PUBLIC_HEART_RATE === "true" &&
    (beat?.workoutStartedAt === activity.timer.startedAt || (beat?.workoutStartedAt === undefined && activity.kind !== "running")) &&
    fresh(beat, now) && beat.at >= activity.timer.startedAt && beat.at <= now ?
    { bpm: beat.bpm, measuredAt: beat.at, expiresAt: beat.expiresAt } : null;
  const track = env.MUSIC_PROVIDER === "push" ? rows.music : spotify;
  const music = fresh(track, now) ? { track: track.track, artist: track.artist, expiresAt: track.expiresAt } : null;
  return { serverTime: now, activity, music, heart };
}
