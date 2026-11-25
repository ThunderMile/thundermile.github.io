import { EventError, eventTime } from "./state.mjs";

export async function saveHealthSummary(storage, input, now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EventError("Expected a summary event.");
  const at = eventTime(input.at, now);
  const { kind, id, durationSeconds, startedAt, distanceMeters } = input.summary || {};
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) throw new EventError("Invalid duration.");

  let summary;
  if (kind === "run" && typeof id === "string" && /^[0-9a-f]{64}$/.test(id)) {
    const start = eventTime(startedAt, now);
    if (distanceMeters !== undefined && (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0)) {
      throw new EventError("Invalid distance.");
    }
    summary = { kind, id, durationSeconds, startedAt: new Date(start).toISOString() };
    if (distanceMeters !== undefined) summary.distanceMeters = distanceMeters;
  } else if (kind === "sleep" && typeof id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
    const day = Date.parse(id);
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== id) throw new EventError("Invalid sleep date.");
    summary = { kind, id, durationSeconds };
  } else {
    throw new EventError("Invalid summary kind or ID.");
  }

  const key = `health:${kind}:${id}`;
  const previous = await storage.get(key);
  if (previous && at <= previous.at) return false;
  const changed = !previous || JSON.stringify(previous.summary) !== JSON.stringify(summary);
  await storage.put(key, { at, summary });
  return changed;
}
