import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.env.WEBUI_ROOT || join(fileURLToPath(new URL(".", import.meta.url)), "dist"));
const host = process.env.WEBUI_HOST || "0.0.0.0";
const port = Number(process.env.WEBUI_PORT || "8080");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json; charset=utf-8", ".woff2": "font/woff2" };
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; connect-src 'self' https: http: wss: ws:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https: http:; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (["/healthz", "/healthz/live", "/healthz/ready"].includes(url.pathname)) return send(response, 200, "text/plain; charset=utf-8", "ok\n", { "Cache-Control": "no-store" });
    if (url.pathname === "/config.json") {
      const base = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
      const config = {
        ...base,
        defaultServerUrl: process.env.STALWART_URL ?? base.defaultServerUrl,
        allowCustomServers: envBoolean("ALLOW_CUSTOM_SERVERS", base.allowCustomServers),
        allowBasicAuth: envBoolean("ALLOW_BASIC_AUTH", base.allowBasicAuth),
        allowOAuth: envBoolean("ALLOW_OAUTH", base.allowOAuth),
        pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || base.pollIntervalSeconds),
      };
      return send(response, 200, "application/json; charset=utf-8", JSON.stringify(config), { "Cache-Control": "no-store" });
    }
    const decoded = decodeURIComponent(url.pathname);
    const relative = normalize(decoded).replace(/^[/\\]+/, "");
    let path = resolve(join(root, relative));
    if (!path.startsWith(`${root}/`) && path !== root) return send(response, 400, "text/plain", "Bad request");
    let info = await stat(path).catch(() => null);
    if (info?.isDirectory()) { path = join(path, "index.html"); info = await stat(path).catch(() => null); }
    if (!info?.isFile()) path = join(root, "index.html");
    const extension = extname(path);
    const cache = path.endsWith("index.html") ? "no-cache" : path.includes(`${join(root, "assets")}/`) ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    return send(response, 200, types[extension] || "application/octet-stream", await readFile(path), { "Cache-Control": cache });
  } catch (error) {
    console.error(error); send(response, 500, "text/plain; charset=utf-8", "Internal server error\n", { "Cache-Control": "no-store" });
  }
}).listen(port, host, () => console.log(`Stalwart Web UI listening on http://${host}:${port}`));

function envBoolean(name, fallback) { const value = process.env[name]; return value == null ? fallback : !["0", "false", "no", "off"].includes(value.toLowerCase()); }
function send(response, status, type, body, extra = {}) { response.writeHead(status, { ...securityHeaders, "Content-Type": type, ...extra }); response.end(body); }
