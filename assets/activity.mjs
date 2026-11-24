import { statusUrl, schedule } from "./profile-config.mjs";
import { scheduledClass } from "./schedule.mjs";

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
function elapsed(timer, now) {
  const ms = timer.accruedMs + (timer.paused ? 0 : Math.max(0, now - timer.since));
  const s = Math.floor(ms / 1000);
  const two = n => String(n).padStart(2, "0");
  const duration = (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + two(Math.floor(s / 60) % 60) + ":" + two(s % 60);
  return (timer.activeTime ? "Active time " : "Elapsed time ") + duration + (timer.paused ? " · Paused" : "");
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
  textAt("workout-timer", main.timer ? elapsed(main.timer, now) : "");
  const heart = !demo && main.timer && snapshot.heart?.expiresAt > now ? snapshot.heart : null;
  byId("heart").hidden = !heart;
  const age = heart ? Math.max(0, Math.floor((now - heart.measuredAt) / 1000)) : 0;
  textAt("heart", heart ? heart.bpm + " BPM · measured " + age + "s ago" : "");
  const music = local && previewMusic.checked ? { track: "Preview track", artist: "Preview artist" } :
    !demo && snapshot.music?.expiresAt > now ? snapshot.music : null;
  byId("music").hidden = !music;
  textAt("track", music ? music.track + " — " + music.artist : "");
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
