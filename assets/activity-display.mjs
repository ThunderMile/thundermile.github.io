const twoDigits = value => String(value).padStart(2, "0");
const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export function workoutLine(timer, now) {
  const ms = timer.accruedMs + (timer.paused ? 0 : Math.max(0, now - timer.since));
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const duration = (hours ? hours + ":" : "") + twoDigits(Math.floor(seconds / 60) % 60) + ":" + twoDigits(seconds % 60);
  return (timer.activeTime ? "Active time " : "Since start ") + duration + (timer.paused ? " · Paused" : "");
}

export function lastUpdateLine(updatedAt, now) {
  if (!Number.isFinite(updatedAt) || updatedAt > now) return "";
  const seconds = Math.floor((now - updatedAt) / 1000);
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  return `Last update ${elapsed} ago`;
}

export function heartAt(sample, now) {
  return sample && Number.isFinite(sample.bpm) && sample.bpm > 0 &&
    Number.isFinite(sample.measuredAt) && sample.measuredAt <= now &&
    Number.isFinite(sample.expiresAt) && now < sample.expiresAt ? sample : null;
}

export function musicLine(music, now) {
  if (!music?.track || !(music.expiresAt > now)) return "";
  return "♪ " + music.track + (music.artist ? " — " + music.artist : "");
}

export function bedtimeLine(startedAt, now) {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  const elapsed = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `since ${clock.format(startedAt)} · ${elapsed} elapsed`;
}

export function sleepObservation(observation, now) {
  if (!observation || observation.endedAt > now || observation.expiresAt <= now) return "";
  const age = Math.floor((now - observation.endedAt) / 60_000);
  return `Observed ${observation.stage} · ${clock.format(observation.startedAt)}–${clock.format(observation.endedAt)} · ${age}m ago`;
}
