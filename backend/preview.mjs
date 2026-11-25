import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isIPv4 } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const base = fileURLToPath(new URL("./", import.meta.url));
const site = resolve(base, "..");
const state = join(base, ".preview-data");
const device = process.argv.includes("--device");
const ephemeral = device || process.argv.includes("--ephemeral");
const wifiIP = !ephemeral || device ? process.env.PORTFOLIO_WIFI_IP : undefined;
if (wifiIP && !isIPv4(wifiIP)) throw new Error("PORTFOLIO_WIFI_IP must be a local IPv4 address.");
if (device && !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(wifiIP || ""))
  throw new Error("--device requires a private PORTFOLIO_WIFI_IP.");
await mkdir(state, { recursive: true, mode: 0o700 });
const tokenFile = join(state, device ? "device-write-token" : ephemeral ? "simulator-write-token" : "write-token");
const newToken = (device ? "device-preview-" : "") + randomBytes(32).toString("hex");
try { await writeFile(tokenFile, newToken, { flag: "wx", mode: 0o600 }); }
catch (e) { if (e.code !== "EEXIST") throw e; }
const token = (await readFile(tokenFile, "utf8")).trim();
const traceFile = device ? join(state, "device-delivery-" + Date.now() + ".jsonl") : null;
const runtime = new Miniflare({
  modules: true, scriptPath: join(base, "src/worker.mjs"), modulesRoot: join(base, "src"),
  host: "127.0.0.1", compatibilityDate: "2026-03-01",
  durableObjects: { ROOM: { className: "StatusRoom", useSQLite: true } },
  durableObjectsPersist: ephemeral ? false : join(state, "storage"),
  bindings: { WRITE_TOKEN: token,
    ...((!ephemeral || device) && { LANYARD_USER_ID: "1002637103991111802" }),
    VIDEO_APPS: '["Preview Video","Bilibili"]', PUBLIC_HEART_RATE: process.env.PUBLIC_HEART_RATE === "true" ? "true" : "false",
    PUBLIC_SLEEP_STAGE: process.env.PUBLIC_SLEEP_STAGE === "true" ? "true" : "false", MUSIC_PROVIDER: "push" }
});
await runtime.ready;
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".ttf": "font/ttf" };
const port = Number(process.env.PORT || 8768);
const serve = async (req, res) => {
  try {
    const host = req.socket.localAddress;
    if (req.headers.host !== host + ":" + port && !(host === "127.0.0.1" && req.headers.host === "localhost:" + port))
      return res.writeHead(403).end();
    const url = new URL(req.url, "http://127.0.0.1:" + port);
    if (device && url.pathname === "/api/preview/check" && req.method === "POST") {
      return res.writeHead(req.headers.authorization === "Bearer " + token ? 204 : 401).end();
    }
    if (device && host !== "127.0.0.1" && !(req.method === "POST" &&
        ["/api/events", "/api/health/summaries"].includes(url.pathname))) return res.writeHead(404).end();
    if (url.pathname.startsWith("/api/")) {
      const receivedAt = Date.now();
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await runtime.dispatchFetch(url, { method: req.method, headers: req.headers, body });
      const reply = Buffer.from(await r.arrayBuffer());
      if (traceFile && req.method === "POST" && r.ok && JSON.parse(reply).applied === true) {
        const { source, action, at, measuredAt, startedAt, endedAt } = JSON.parse(body);
        await writeFile(traceFile, JSON.stringify({ source, action, at, measuredAt, startedAt, endedAt, receivedAt }) + "\n",
          { flag: "a", mode: 0o600 }).catch(() => console.error("Could not write the local delivery timing trace."));
      }
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(reply);
    }
    if (!["GET", "HEAD"].includes(req.method)) return res.writeHead(405).end();
    let route = decodeURIComponent(url.pathname);
    if (route.endsWith("/")) route += "index.html";
    if (!(route === "/index.html" || route === "/experience/index.html" || route === "/projects/index.html" ||
      route === "/projects/widefield-assembly/index.html" || route.startsWith("/assets/")) ||
      route.includes("\\") || route.includes("/.")) return res.writeHead(404).end();
    const file = resolve(site, "." + route);
    if (!file.startsWith(site + sep) || !mime[extname(file)]) return res.writeHead(404).end();
    const { size } = await stat(file);
    const headers = { "Content-Type": mime[extname(file)], "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end) return res.writeHead(416, { "Content-Range": "bytes */" + size }).end();
    if (range) headers["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
    res.writeHead(range ? 206 : 200, { ...headers, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(file, { start, end });
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.destroy()).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.writeHead(err.code === "ENOENT" ? 404 : 500);
    res.end();
  }
};
const addresses = new Set(["127.0.0.1", ...(wifiIP ? [wifiIP] : [])]);
const servers = [...addresses].map(address => createServer(serve).listen(port, address, () =>
  console.log("Portfolio status: http://" + address + ":" + port + "/api/status")));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, async () => {
  for (const server of servers) server.close();
  await runtime.dispose(); process.exit(0);
});
