import { statusUrl, schedule } from "./profile-config.mjs?v=20261124";
import { scheduledClass } from "./schedule.mjs?v=20261124";
import { bedtimeLine, heartAt, lastUpdateLine, musicLine, sleepObservation, workoutLine } from "./activity-display.mjs";

const byId = id => document.getElementById(id);
const canvas = byId("character");
const mode = byId("preview-activity");
const previewMusic = byId("preview-music");
const motionButton = byId("motion");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
const wifiPreview = location.protocol === "http:" && /^\d+(?:\.\d+){3}$/.test(location.hostname);
const endpoint = local || wifiPreview ? "/api/status" : statusUrl;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const labels = { idle: "Idle", class: "On my schedule · Example course", running: "Running",
  swimming: "Swimming", strength: "Strength training", jump_rope: "Jumping rope", badminton: "Badminton",
  gaming: "Playing · Example game", video: "On Preview Video", bedtime: "Bedtime" };
const workouts = ["running", "swimming", "strength", "jump_rope", "badminton"];
let snapshot = {}, offset = 0, previewStart = 0, frame = 0, kind, interval, pollTimeout, pending = false;
let freeze = reduced.matches;

function textAt(id, value) {
  const el = byId(id);
  if (el.textContent !== value) el.textContent = value;
}
function draw() { window.drawCharacter(canvas, kind || "idle", frame); }
function motion() {
  clearInterval(interval);
  document.body.classList.toggle("motion-stopped", freeze);
  motionButton.hidden = reduced.matches;
  motionButton.setAttribute("aria-label", freeze ? "Play animation" : "Pause animation");
  motionButton.title = motionButton.getAttribute("aria-label");
  motionButton.firstElementChild.textContent = freeze ? "▶" : "Ⅱ";
  if (freeze) { frame = 0; draw(); }
  else if (!document.hidden) interval = setInterval(() => {
    frame = (frame + 1) % window.characterFrames; draw();
  }, 160);
}
function updateHeart(sample, now) {
  const reading = heartAt(sample, now);
  const element = byId("heart");
  element.classList.toggle("heart-fresh", Boolean(reading));
  const label = reading ? `${reading.bpm} BPM` : "Heart rate unavailable";
  if (element.getAttribute("aria-label") !== label) element.setAttribute("aria-label", label);
  if (reading) element.style.setProperty("--beat-duration", `${60 / reading.bpm}s`);
  textAt("heart-symbol", reading ? "♥" : "♡");
  textAt("heart-value", reading ? label : "--");
}
const fallbackIcon = new URL("./media/gamepad.png", import.meta.url).href;
let shownGame, shownIcon;
function gameIcon(main) {
  const title = main.kind === "gaming" ? main.label : null;
  const url = title && (main.icon || fallbackIcon);
  if (title === shownGame && url === shownIcon) return;
  shownGame = title; shownIcon = url;
  const slot = byId("game-icon");
  slot.hidden = !title;
  slot.replaceChildren();
  if (!title) return;
  const image = new Image(30, 30);
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  const useFallback = () => { image.className = "pixel"; image.src = fallbackIcon; };
  if (url === fallbackIcon) useFallback();
  else {
    image.addEventListener("error", useFallback, { once: true });
    image.src = url;
  }
  slot.append(image);
}
function render() {
  const now = Date.now() + offset;
  const demo = local && mode.value;
  let main;
  if (demo) {
    main = { kind: demo, label: labels[demo] };
    if (workouts.includes(demo)) main.timer = { since: previewStart, accruedMs: 0 };
  } else if (snapshot.activity?.expiresAt > now) main = snapshot.activity;
  else main = scheduledClass(schedule, now) || { kind: "idle", label: "Idle" };
  if (kind !== main.kind) { kind = main.kind; frame = 0; draw(); }
  textAt("activity-label", main.label);
  gameIcon(main);
  byId("workout-timer").hidden = !main.timer;
  textAt("workout-timer", main.timer ? workoutLine(main.timer, now) : "");
  const bedtime = main.kind === "bedtime" && Number.isFinite(main.startedAt);
  byId("bedtime-timer").hidden = !bedtime;
  textAt("bedtime-timer", bedtime ? bedtimeLine(main.startedAt, now) : "");
  const observation = bedtime && !demo ? sleepObservation(snapshot.sleepStage, now) : "";
  byId("sleep-observation").hidden = !observation;
  textAt("sleep-observation", observation || "");
  const activityUpdatedAt = snapshot.activityUpdatedAt ?? main.timer?.since ?? main.startedAt;
  const lastUpdatedAt = snapshot.lastUpdatedAt ??
    Math.max(...[activityUpdatedAt, snapshot.heart?.measuredAt].filter(Number.isFinite));
  byId("last-update").hidden = Boolean(demo);
  textAt("last-update", lastUpdateLine(lastUpdatedAt, now) || "Last update —");
  updateHeart(snapshot.heart, now);
  const place = !demo && snapshot.location?.expiresAt > now ? snapshot.location.label : "";
  byId("location").hidden = !place;
  textAt("location", place);
  const music = local && previewMusic.checked ? { track: "Preview track", artist: "Preview artist", expiresAt: Infinity } :
    demo ? null : snapshot.music;
  const song = musicLine(music, now);
  byId("music").hidden = !song;
  textAt("music", song);
}
async function poll() {
  clearTimeout(pollTimeout);
  if (!endpoint || document.hidden || pending) return;
  pending = true;
  try {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Unavailable");
    const data = await response.json();
    if (Number.isFinite(data.serverTime)) { snapshot = data; offset = data.serverTime - Date.now(); }
  } catch { /* Retain the last observation only until its own expiry. */ }
  finally {
    pending = false; render();
    if (!document.hidden) pollTimeout = setTimeout(poll, local ? 2000 : 12_000);
  }
}
if (local) {
  byId("preview").hidden = false;
  byId("preview").open = new URLSearchParams(location.search).get("preview") === "1";
  mode.addEventListener("change", () => { previewStart = Date.now() + offset; render(); });
  previewMusic.addEventListener("change", render);
}
motionButton.addEventListener("click", () => { freeze = !freeze; motion(); });
reduced.addEventListener("change", event => { freeze = event.matches; motion(); });
document.addEventListener("visibilitychange", () => { motion(); if (!document.hidden) { render(); poll(); } });
render(); motion(); poll();
setInterval(() => { if (!document.hidden) render(); }, 1000);
