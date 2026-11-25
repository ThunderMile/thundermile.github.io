const minute = 60_000;
export const workoutLabels = {
  running: "Running", swimming: "Swimming", strength: "Strength training",
  jump_rope: "Jumping rope", badminton: "Badminton"
};
const lifetimes = { workout: 360 * minute, riot: 90_000, video: 90 * minute,
  bedtime: 720 * minute, heart: 20 * minute, sleep_stage: 2 * minute, music: 90_000, location: 1440 * minute };
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

export function eventTime(value, now) {
  requireValue(typeof value === "string" && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value),
    "at must be an ISO 8601 timestamp with a timezone.");
  const at = Date.parse(value);
  requireValue(Number.isFinite(at) && at <= now + 60_000, "Invalid or future timestamp.");
  return at;
}

// Keep each last accepted timestamp, including after an end or natural expiry.
export function applyEvent(rows, input, env, now) {
  requireValue(input && typeof input === "object" && !Array.isArray(input), "Expected an event object.");
  const { source, action } = input;
  requireValue(Object.hasOwn(lifetimes, source), "Unknown source.");
  let at = eventTime(input.at, now);
  // Discard packets and stored sessions from the retired Watch companion experiment.
  if (source === "workout" && input.sessionId !== undefined) return false;
  const permitted = source === "workout" ? ["start", "pause", "resume", "end"] :
    ["heart", "sleep_stage", "location"].includes(source) ? ["reading", "end"] : ["start", "end"];
  requireValue(permitted.includes(action), "Unknown action for this source.");
  let key = source;
  if (source === "video") {
    requireValue(allowedApps(env).includes(input.app), "App is outside the sharing allowlist.");
    key = "video:" + input.app;
  }
  if (source === "heart" && action === "reading") {
    requireValue(env.PUBLIC_HEART_RATE === "true", "Heart-rate sharing is disabled.");
    at = eventTime(input.measuredAt, now);
  }
  if (source === "sleep_stage" && action === "reading") {
    requireValue(env.PUBLIC_SLEEP_STAGE === "true", "Sleep-stage sharing is disabled.");
    at = eventTime(input.endedAt, now);
  }
  if (source === "music") {
    requireValue(env.MUSIC_PROVIDER === "push", "Pushed music is disabled.");
    if (action === "start" && at + lifetimes.music <= now) return false;
  }
  const prev = source === "workout" && rows.workout?.sessionId !== undefined ? undefined : rows[key];
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
      break;
    case "sleep_stage":
      next.startedAt = eventTime(input.startedAt, now);
      requireValue(next.startedAt < at && ["REM", "Core", "Deep", "Awake"].includes(input.stage), "Invalid sleep observation.");
      next.stage = input.stage;
      break;
    case "music":
      next.track = cleanText(input.track);
      requireValue(!["itunes media", "no items"].includes(next.track.toLowerCase()), "Expected a song title.");
      if (input.artist != null) next.artist = cleanText(input.artist);
      break;
    case "location":
      requireValue(["Home", "School", "Travel"].includes(input.place), "Unknown coarse location.");
      next.label = input.place === "Travel" ? "Travel · " + cleanText(input.city) : input.place;
      break;
  }
  rows[key] = next;
  return true;
}

export function publicStatus(rows, steam, spotify, env, now, discord = null, gameUpdatedAt = null) {
  const videoStates = allowedApps(env).map(app => rows["video:" + app]);
  const apps = videoStates.filter(item => fresh(item, now));
  apps.sort((a, b) => b.at - a.at);
  const workout = rows.workout?.sessionId === undefined ? rows.workout : undefined;
  const main = [workout, discord, rows.riot, steam, apps[0], rows.bedtime].find(item => fresh(item, now));
  const activity = main ? { kind: main.kind, label: main.label, expiresAt: main.expiresAt } : null;
  if (main?.timer) activity.timer = main.timer;
  if (main?.kind === "bedtime") activity.startedAt = main.at;
  if (main?.kind === "gaming" && main.icon) activity.icon = main.icon;
  const beat = rows.heart;
  const shareHeart = env.PUBLIC_HEART_RATE === "true" && beat?.action === "reading";
  const heart = shareHeart && fresh(beat, now) && beat.at <= now ?
    { bpm: beat.bpm, measuredAt: beat.at, expiresAt: beat.expiresAt } : null;
  const updateTimes = [
    workout?.at, rows.riot?.at, rows.bedtime?.at, gameUpdatedAt, ...videoStates.map(item => item?.at),
    shareHeart ? beat.at : undefined
  ];
  const lastUpdatedAt = Math.max(...updateTimes.filter(at => Number.isFinite(at) && at <= now));
  const stage = rows.sleep_stage;
  const sleepStage = env.PUBLIC_SLEEP_STAGE === "true" && main?.kind === "bedtime" && fresh(stage, now) &&
    stage.at <= now && stage.at >= main.at ?
    { stage: stage.stage, startedAt: stage.startedAt, endedAt: stage.at, expiresAt: stage.expiresAt } : null;
  const track = env.MUSIC_PROVIDER === "push" ? rows.music : spotify;
  const music = fresh(track, now) ?
    { track: track.track, ...(track.artist && { artist: track.artist }), expiresAt: track.expiresAt } : null;
  const location = fresh(rows.location, now) ?
    { label: rows.location.label, expiresAt: rows.location.expiresAt } : null;
  return { serverTime: now, activity, music, heart, ...(sleepStage && { sleepStage }), ...(location && { location }),
    ...(Number.isFinite(lastUpdatedAt) && { lastUpdatedAt }) };
}
