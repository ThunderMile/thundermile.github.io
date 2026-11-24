import { applyEvent, EventError, publicStatus } from "./state.mjs";
import { Providers } from "./providers.mjs";

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers }
});
const publicHeaders = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/status") {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405, { ...publicHeaders, Allow: "GET" });
    } else if (path === "/api/events") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405, { Allow: "POST" });
      if (!env.WRITE_TOKEN || request.headers.get("authorization") !== "Bearer " + env.WRITE_TOKEN)
        return json({ error: "Authentication required." }, 401);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
        return json({ error: "Use application/json." }, 415);
      if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Event too large." }, 413);
    } else return json({ error: "Unknown endpoint." }, 404);
    return env.ROOM.get(env.ROOM.idFromName("mile")).fetch(request);
  }
};

export class StatusRoom {
  constructor(ctx, env) {
    this.env = env;
    this.storage = ctx.storage;
    this.providers = new Providers(env, ctx.storage);
  }
  async fetch(request) {
    if (request.method === "GET") {
      const [discord, steam, spotify] = await Promise.all([
        this.providers.discord(), this.providers.steam(), this.providers.spotify()
      ]);
      const rows = await this.storage.get("sources") || {};
      return json(publicStatus(rows, steam, spotify, this.env, Date.now(), discord), 200, publicHeaders);
    }
    try {
      const body = await request.text();
      if (body.length > 4096) return json({ error: "Event too large." }, 413);
      const event = JSON.parse(body);
      const applied = await this.storage.transaction(async txn => {
        const rows = await txn.get("sources") || {};
        const changed = applyEvent(rows, event, this.env, Date.now());
        if (changed) await txn.put("sources", rows);
        return changed;
      });
      return json({ applied });
    } catch (error) {
      if (error instanceof EventError || error instanceof SyntaxError) return json({ error: error.message }, 400);
      throw error;
    }
  }
}
