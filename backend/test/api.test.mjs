import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, createFetchMock } from "miniflare";

test("Worker authentication, concurrent source updates, restart persistence and public redaction", async () => {
  const base = fileURLToPath(new URL("../", import.meta.url));
  const scratch = resolve(base, ".preview-data");
  await mkdir(scratch, { recursive: true });
  const folder = await mkdtemp(join(scratch, "api-test-"));
  const token = randomBytes(32).toString("hex");
  const options = { modules: true, scriptPath: join(base, "src/worker.mjs"), modulesRoot: join(base, "src"),
    compatibilityDate: "2026-03-01", host: "127.0.0.1", durableObjectsPersist: folder,
    durableObjects: { ROOM: { className: "StatusRoom", useSQLite: true } },
    bindings: { WRITE_TOKEN: token, MUSIC_PROVIDER: "push", VIDEO_APPS: '["Test app"]', PUBLIC_HEART_RATE: "false" } };
  let runtime = new Miniflare(options);
  const at = Date.now() - 2000;
  const put = (source,action,ms,extra={},bearer=token) => runtime.dispatchFetch("http://local/api/events", {
    method:"POST", headers:{ "Content-Type":"application/json", Authorization:"Bearer " + bearer },
    body:JSON.stringify({source,action,at:new Date(at+ms).toISOString(),...extra})
  });
  const read = async () => (await runtime.dispatchFetch("http://local/api/status")).json();
  try {
    assert.equal((await put("workout","start",0,{kind:"running"},"wrong")).status,401);
    assert.equal((await put("heart","reading",1,{bpm:110})).status,400);
    assert.equal((await put("video","start",2,{app:"Unshared"})).status,400);
    const writes = await Promise.all([
      put("workout","start",10,{kind:"running"}), put("riot","start",9,{game:"VALORANT"}),
      put("video","start",7,{app:"Test app"}), put("music","start",8,{track:"One",artist:"Two"})
    ]);
    for (const r of writes) assert.equal(r.status,200);
    let state = await read();
    assert.equal(state.activity.label,"Running"); assert.equal(state.music.track,"One"); assert.equal(state.heart,null);
    assert.deepEqual(Object.keys(state).sort(),["activity","heart","music","serverTime"]);
    await runtime.dispose(); runtime = new Miniflare(options);
    assert.equal((await read()).activity.label,"Running");
    await put("workout","end",15);
    assert.deepEqual(await (await put("workout","start",10,{kind:"running"})).json(),{applied:false});
    state = await read();
    assert.equal(state.activity.label,"Playing · VALORANT"); assert.equal(state.activity.timer,undefined);
    await put("video","end",16,{app:"Test app"}); await put("riot","end",17); await put("music","end",18);
    state = await read(); assert.equal(state.activity,null); assert.equal(state.music,null);
  } finally {
    await runtime.dispose();
    if (resolve(folder).startsWith(join(scratch,"api-test-"))) await rm(folder,{recursive:true,force:true,maxRetries:3});
  }
});

test("Worker runtime fetches Lanyard and publishes only the game label", async () => {
  const id = "123456789012345678";
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  fetchMock.get("https://api.lanyard.rest").intercept({ method: "GET", path: "/v1/users/" + id })
    .reply(200, { success: true, data: { discord_user: { id }, activities: [
      { type: 2, name: "Music" }, { type: 0, name: "Example title", state: "Private detail" }
    ] } });
  const src = fileURLToPath(new URL("../src/", import.meta.url));
  const runtime = new Miniflare({
    modules: true, modulesRoot: src, scriptPath: join(src, "worker.mjs"), host: "127.0.0.1",
    compatibilityDate: "2026-03-01", durableObjects: { ROOM: { className: "StatusRoom", useSQLite: true } },
    bindings: { LANYARD_USER_ID: id }, fetchMock
  });
  try {
    const request = await runtime.dispatchFetch("http://local/api/status");
    assert.equal(request.status, 200);
    const status = await request.json();
    assert.deepEqual(status.activity, {
      kind: "gaming", label: "Playing · Example title", expiresAt: status.activity?.expiresAt
    });
    assert(status.activity.expiresAt > status.serverTime);
    assert.equal(status.music, null);
    assert.equal(status.heart, null);
  } finally {
    await runtime.dispose();
    await fetchMock.close();
  }
});
