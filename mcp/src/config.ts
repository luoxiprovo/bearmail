import type { Scope, SendMode } from "./types.js";
import { ALL_SCOPES } from "./types.js";

export interface BearmailConfig {
  server: string;
  username?: string;
  token?: string;
  password?: string;
  scopes: Set<Scope>;
  sendMode: SendMode;
  sendDailyCap: number;
  timezone: string;
  httpHost: string;
  httpPort: number;
  httpPath: string;
  requireTls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  debugJmap: boolean;
  attachmentMaxBytes: number;
  auditLogPath?: string;
  pageSize: number;
  toolRatePerMinute: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function normalizeServerUrl(raw: string): string {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = new URL(withProtocol);
  if (url.username || url.password) throw new ConfigError("Remove credentials from the server URL.");
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new ConfigError("Use HTTPS for remote servers.");
  }
  return url.origin;
}

function parseScopes(value: string | undefined, sendMode: SendMode): Set<Scope> {
  if (!value?.trim()) {
    const defaults: Scope[] = ["mail.read", "mail.draft", "calendar.read", "calendar.write"];
    if (sendMode === "send-allowed") defaults.push("mail.send");
    return new Set(defaults);
  }
  const scopes = new Set<Scope>();
  for (const part of value.split(/[,\s]+/).filter(Boolean)) {
    if (!ALL_SCOPES.includes(part as Scope)) throw new ConfigError(`Unknown scope: ${part}`);
    scopes.add(part as Scope);
  }
  return scopes;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BearmailConfig {
  const serverRaw = env.BEARMAIL_SERVER?.trim();
  if (!serverRaw) throw new ConfigError("Set BEARMAIL_SERVER to the Stalwart HTTPS origin, for example https://mail.example.com.");
  const sendMode = env.BEARMAIL_SEND_MODE === "send-allowed" ? "send-allowed" : "draft-only";
  const httpHost = env.BEARMAIL_MCP_HOST?.trim() || "127.0.0.1";
  const requireTls = env.BEARMAIL_REQUIRE_TLS !== "false";
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(httpHost);
  const tlsCert = env.BEARMAIL_TLS_CERT?.trim() || undefined;
  const tlsKey = env.BEARMAIL_TLS_KEY?.trim() || undefined;
  if (requireTls && !isLocal && !(tlsCert && tlsKey)) {
    throw new ConfigError("HTTP MCP on a non-loopback address requires TLS. Bind to 127.0.0.1 or set BEARMAIL_TLS_CERT and BEARMAIL_TLS_KEY.");
  }
  return {
    server: normalizeServerUrl(serverRaw),
    username: env.BEARMAIL_USERNAME?.trim() || undefined,
    token: env.BEARMAIL_TOKEN?.trim() || undefined,
    password: env.BEARMAIL_PASSWORD?.trim() || undefined,
    scopes: parseScopes(env.BEARMAIL_SCOPES, sendMode),
    sendMode,
    sendDailyCap: Math.max(0, Number(env.BEARMAIL_SEND_DAILY_CAP ?? 50) || 50),
    timezone: env.BEARMAIL_TIMEZONE?.trim() || "UTC",
    httpHost,
    httpPort: Number(env.BEARMAIL_MCP_PORT ?? 8082) || 8082,
    httpPath: env.BEARMAIL_MCP_PATH?.trim() || "/mcp",
    requireTls,
    tlsCert,
    tlsKey,
    debugJmap: env.BEARMAIL_DEBUG_JMAP === "true",
    attachmentMaxBytes: Math.max(1, Number(env.BEARMAIL_ATTACHMENT_MAX_BYTES ?? 1_048_576) || 1_048_576),
    auditLogPath: env.BEARMAIL_AUDIT_LOG?.trim() || undefined,
    pageSize: Math.min(50, Math.max(1, Number(env.BEARMAIL_PAGE_SIZE ?? 20) || 20)),
    toolRatePerMinute: Math.max(1, Number(env.BEARMAIL_TOOL_RATE ?? 60) || 60),
  };
}

export function resolveTemplateUrl(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (url, [key, value]) => url.replaceAll(`{${key}}`, encodeURIComponent(value)),
    template,
  );
}

export function isLoopbackHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}
