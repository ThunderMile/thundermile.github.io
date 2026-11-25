import { applyEvent, EventError, publicStatus } from "./state.mjs";
import { Providers } from "./providers.mjs";
import { saveHealthSummary } from "./health.mjs";

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers }
});
const publicHeaders = { "Access-Control-Allow-Origin": "*" };
const healthPath = "/api/health/summaries";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/status") {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405, { ...publicHeaders, Allow: "GET" });
    } else if (path === "/api/events" || path === healthPath) {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405, { Allow: "POST" });
      const authorization = request.headers.get("authorization");
      if (![env.WRITE_TOKEN, env.IPHONE_WRITE_TOKEN].some(token => token && authorization === "Bearer " + token))
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
      const status = publicStatus(rows, steam, spotify, this.env, Date.now(), discord, this.providers.gameUpdatedAt);
      return json(status, 200, publicHeaders);
    }
    try {
      const body = await request.text();
      if (body.length > 4096) return json({ error: "Event too large." }, 413);
      const event = JSON.parse(body);
      const applied = await this.storage.transaction(async txn => {
        if (new URL(request.url).pathname === healthPath) return saveHealthSummary(txn, event, Date.now());
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
