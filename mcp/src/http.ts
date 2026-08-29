#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, isLoopbackHost, type BearmailConfig } from "./config.js";
import { discoveryDocument } from "./discovery.js";
import { authFromHttpHeader, discoverSession, JmapClient } from "./jmap.js";
import { ToolError } from "./errors.js";
import { BearmailAccount } from "./account.js";
import { createMcpServer } from "./server.js";

interface Session {
  transport: StreamableHTTPServerTransport;
}

export async function startHttpServer(config: BearmailConfig): Promise<{ server: Server; origin: string; path: string }> {
  const sessions = new Map<string, Session>();
  const path = config.httpPath.endsWith("/") ? config.httpPath.slice(0, -1) : config.httpPath;
  const bind = { origin: "" };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (req.method === "GET" && (url.pathname === "/.well-known/mcp.json" || url.pathname === "/healthz/ready")) {
      const body = url.pathname === "/healthz/ready"
        ? { ok: true }
        : discoveryDocument(config.server, { http: `${bind.origin}${path}` });
      json(res, 200, body);
      return;
    }
    if (url.pathname !== path && url.pathname !== `${path}/`) {
      json(res, 404, { error: "notFound" });
      return;
    }
    const authorization = req.headers.authorization;
    if (!authorization) {
      res.setHeader("WWW-Authenticate", "Bearer realm=\"BearMail MCP\"");
      json(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Authorization required." }, id: null });
      return;
    }
    try {
      authFromHttpHeader(authorization);
    } catch {
      json(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Authorization must be Bearer or Basic." }, id: null });
      return;
    }
    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      if (typeof sessionId === "string" && sessions.has(sessionId)) {
        await sessions.get(sessionId)?.transport.close();
        sessions.delete(sessionId);
      }
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "POST" && req.method !== "GET") {
      json(res, 405, { error: "methodNotAllowed" });
      return;
    }

    try {
      const body = req.method === "POST" ? JSON.parse(await readBody(req) || "null") : undefined;
      const sessionId = req.headers["mcp-session-id"];
      let transport: StreamableHTTPServerTransport | undefined;
      if (typeof sessionId === "string" && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!.transport;
      } else if (req.method === "POST" && isInitializeRequest(body)) {
        const auth = authFromHttpHeader(authorization);
        const { session, origin } = await discoverSession(config.server, auth);
        const account = new BearmailAccount(new JmapClient(session, auth, origin), config);
        const mcp = createMcpServer(account);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (transport) sessions.set(id, { transport });
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) sessions.delete(transport.sessionId);
        };
        await mcp.connect(transport);
      } else {
        json(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "Missing MCP session." }, id: null });
        return;
      }
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        if (error instanceof ToolError && error.code === "authenticationFailed") {
          json(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Authorization must be Bearer or Basic." }, id: null });
        } else {
          json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
        }
      }
    }
  };

  const server: Server = config.tlsCert && config.tlsKey
    ? createHttpsServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, handler)
    : createHttpServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(config.httpPort, config.httpHost, () => resolve());
    server.on("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.httpPort;
  const scheme = config.tlsCert && config.tlsKey ? "https" : "http";
  const host = config.httpHost === "0.0.0.0" || config.httpHost === "::" ? "127.0.0.1" : config.httpHost;
  bind.origin = `${scheme}://${host}:${port}`;
  return { server, origin: bind.origin, path };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { origin, path } = await startHttpServer(config);
  console.error(`bearmail-mcp HTTP listening on ${origin}${path}${isLoopbackHost(config.httpHost) ? " (loopback)" : ""}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
