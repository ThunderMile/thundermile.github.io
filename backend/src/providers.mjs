import { discordArtwork, steamArtwork } from "./artwork.mjs";

const leagueModes = new Map([
  ["ranked", "Ranked"], ["ranked solo/duo", "Ranked Solo/Duo"], ["ranked flex", "Ranked Flex"],
  ["swiftplay", "Swiftplay"], ["aram", "ARAM"], ["arena", "Arena"],
  ["draft pick", "Draft Pick"], ["quickplay", "Quickplay"]
]);

// One instance per shared Durable Object. Concurrent readers share each in-flight poll.
export class Providers {
  constructor(env, storage, request = fetch, clock = Date.now) {
    Object.assign(this, { env, storage, request, clock });
    this.cache = new Map();
    this.gameUpdatedAt = null;
  }
  async cached(name, load, intervalMs = 20_000) {
    const now = this.clock();
    const entry = this.cache.get(name) || { next: 0, value: null };
    this.cache.set(name, entry);
    if (entry.pending) return entry.pending;
    if (entry.next > now) return entry.value;
    entry.pending = (async () => {
      try {
        const value = await load();
        if ((entry.value?.kind === "gaming" || value?.kind === "gaming") && entry.value?.label !== value?.label) {
          this.gameUpdatedAt = this.clock();
        }
        entry.value = value;
        entry.next = this.clock() + intervalMs;
      } catch (err) {
        entry.next = this.clock() + (err.retryMs || intervalMs);
        // Transient failures leave the last observation to expire at its original time.
      } finally {
        entry.pending = null;
      }
      return entry.value;
    })();
    return entry.pending;
  }
  async get(url, init = {}, timeoutMs = 4500) {
    const request = this.request;
    const res = await request(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return res;
    const error = new Error("Provider unavailable");
    error.status = res.status;
    const retry = Number(res.headers.get("retry-after"));
    if (res.status === 429 && retry > 0) error.retryMs = Math.min(86400, retry) * 1000;
    throw error;
  }
  discord() {
    const id = this.env.LANYARD_USER_ID;
    if (!/^\d{17,20}$/.test(id || "")) return null;
    return this.cached("discord", async () => {
      const response = await this.get("https://api.lanyard.rest/v1/users/" + id, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" }
      });
      const presence = await response.json();
      if (presence?.success !== true || !Array.isArray(presence.data?.activities))
        throw new Error("Invalid Lanyard presence");
      const games = presence.data.activities.filter(activity =>
        activity?.type === 0 && typeof activity.name === "string" && activity.name.trim());
      const [game] = games;
      if (!game) return null;
      const expiresAt = this.clock() + 30_000;
      const title = game.name.trim();
      const matching = games.filter(activity => activity.name.trim() === title);
      const modes = title === "League of Legends" ? new Set(matching
        .flatMap(activity => [activity.details, activity.state])
        .filter(value => typeof value === "string")
        .map(value => leagueModes.get(value.trim().toLowerCase()))
        .filter(Boolean)) : null;
      const mode = modes?.size === 1 ? modes.values().next().value : null;
      const label = "Playing · " + title + (mode ? " · " + mode : "");
      let icon;
      for (const activity of matching) {
        icon = await discordArtwork(this, activity);
        if (icon) break;
      }
      return { kind: "gaming", label, expiresAt, icon };
    }, 8000);
  }
  steam() {
    const { STEAM_ID64, STEAM_API_KEY } = this.env;
    if (!STEAM_API_KEY || !/^\d{17}$/.test(STEAM_ID64 || "")) return null;
    return this.cached("steam", async () => {
      const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
      url.search = new URLSearchParams({ key: STEAM_API_KEY, steamids: STEAM_ID64 });
      const data = await (await this.get(url)).json();
      const p = data.response?.players?.find(player => player.steamid === STEAM_ID64);
      if (!p?.gameid || String(p.gameid) === "0" || !p.gameextrainfo) return null;
      return { kind: "gaming", label: "Playing · " + String(p.gameextrainfo).slice(0, 120),
        expiresAt: this.clock() + 60_000, icon: await steamArtwork(this, p.gameid, p.gameextrainfo) };
    });
  }
  async accessToken() {
    if (this.access && this.access.until > this.clock()) return this.access.value;
    const env = this.env;
    const previous = await this.storage.get("spotify-rotation");
    const seed = env.SPOTIFY_REFRESH_TOKEN;
    const refresh = previous?.seed === seed ? previous.value : seed;
    const result = await this.get("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET) },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh })
    });
    const token = await result.json();
    if (!token.access_token) throw new Error("Token unavailable");
    if (token.refresh_token) await this.storage.put("spotify-rotation", { seed, value: token.refresh_token });
    this.access = { value: token.access_token, until: this.clock() + (Number(token.expires_in) - 60) * 1000 };
    return this.access.value;
  }
  spotify() {
    const e = this.env;
    if (e.MUSIC_PROVIDER !== "spotify" || !e.SPOTIFY_CLIENT_ID || !e.SPOTIFY_CLIENT_SECRET || !e.SPOTIFY_REFRESH_TOKEN) return null;
    return this.cached("spotify", async () => {
      let r;
      try {
        r = await this.get("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: "Bearer " + await this.accessToken() }
        });
      } catch (error) {
        if (error.status === 401) this.access = null;
        throw error;
      }
      if (r.status === 204) return null;
      const p = await r.json();
      if (!p.is_playing || p.currently_playing_type !== "track" || !p.item?.name || !p.item.artists?.length) return null;
      const remaining = Number.isFinite(p.progress_ms) && Number.isFinite(p.item.duration_ms) ?
        Math.max(0, p.item.duration_ms - p.progress_ms) : 60_000;
      return { track: p.item.name, artist: p.item.artists.map(a => a.name).join(", "),
        expiresAt: this.clock() + Math.min(60_000, remaining) };
    });
  }
}
