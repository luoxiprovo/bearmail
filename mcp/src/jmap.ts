import { CAPABILITIES, type JmapMethodCall, type JmapResponse, type JmapSession } from "./types.js";
import { ToolError } from "./errors.js";
import { normalizeServerUrl, resolveTemplateUrl } from "./config.js";

export interface AuthProvider {
  header(): string;
}

export class BasicAuthProvider implements AuthProvider {
  constructor(private readonly username: string, private readonly password: string) {}
  header(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
  }
}

export class BearerAuthProvider implements AuthProvider {
  constructor(private readonly token: string) {}
  header(): string {
    return `Bearer ${this.token}`;
  }
}

function ensureHttpUrl(value: string, name: string, origin: string): void {
  const url = new URL(value);
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new ToolError(`The server returned an insecure ${name} URL.`, "insecureUrl");
  }
  if (url.origin !== new URL(origin).origin) {
    throw new ToolError(`The server returned a ${name} URL on another origin.`, "crossOriginRedirect");
  }
}

export async function fetchSameOrigin(url: string, origin: string, init: RequestInit = {}, hops = 5): Promise<Response> {
  let current = new URL(url);
  for (let i = 0; i < hops; i++) {
    if (current.origin !== origin) throw new ToolError("Refusing to call a URL on another origin.", "crossOriginRedirect");
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ToolError("The server redirected without a location.", "crossOriginRedirect");
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new ToolError("Too many redirects.", "crossOriginRedirect");
}

export async function discoverSession(serverInput: string, auth: AuthProvider): Promise<{ origin: string; session: JmapSession }> {
  const origin = normalizeServerUrl(serverInput);
  const headers = { Authorization: auth.header(), Accept: "application/json" };
  let response = await fetchSameOrigin(`${origin}/.well-known/jmap`, origin, { headers });
  if (response.status === 404) {
    response = await fetchSameOrigin(`${origin}/jmap/session`, origin, { headers });
  }
  if (response.status === 401 || response.status === 403) throw new ToolError("The server rejected those credentials.", "authenticationFailed");
  if (!response.ok) throw new ToolError(`JMAP discovery failed (${response.status}).`, "discoveryFailed");
  const session = await response.json() as JmapSession;
  if (!session.apiUrl || !session.accounts || !session.primaryAccounts) {
    throw new ToolError("The server returned an incomplete JMAP session.", "invalidSession");
  }
  ensureHttpUrl(session.apiUrl, "API", origin);
  ensureHttpUrl(session.uploadUrl, "upload", origin);
  ensureHttpUrl(session.downloadUrl, "download", origin);
  if (session.eventSourceUrl) ensureHttpUrl(session.eventSourceUrl, "event source", origin);
  return { origin, session };
}

export class JmapClient {
  constructor(
    readonly session: JmapSession,
    private readonly auth: AuthProvider,
    readonly origin: string,
  ) {}

  get mailAccountId(): string {
    return this.session.primaryAccounts[CAPABILITIES.mail] ?? this.firstAccountId;
  }

  get calendarAccountId(): string {
    return this.session.primaryAccounts[CAPABILITIES.calendars] ?? this.mailAccountId;
  }

  get firstAccountId(): string {
    const id = Object.keys(this.session.accounts)[0];
    if (!id) throw new ToolError("No account is available to this user.", "accountNotFound");
    return id;
  }

  has(capability: string): boolean {
    return capability in this.session.capabilities
      || Object.values(this.session.accounts).some((account) => capability in account.accountCapabilities);
  }

  async request(using: string[], methodCalls: JmapMethodCall[]): Promise<JmapResponse> {
    const response = await fetchSameOrigin(this.session.apiUrl, this.origin, {
      method: "POST",
      headers: {
        Authorization: this.auth.header(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ using: [...new Set([CAPABILITIES.core, ...using])], methodCalls }),
    });
    if (response.status === 401) throw new ToolError("Your session has expired.", "authenticationFailed");
    if (!response.ok) throw new ToolError(`The server request failed (${response.status}).`, "httpError");
    return await response.json() as JmapResponse;
  }

  async call<T>(capability: string | string[], method: string, arguments_: Record<string, unknown>, tag = "0"): Promise<T> {
    const response = await this.request(Array.isArray(capability) ? capability : [capability], [[method, arguments_, tag]]);
    const result = response.methodResponses[0];
    if (!result) throw new ToolError("The server returned no response.", "emptyResponse", method);
    if (result[0] === "error") {
      throw new ToolError(String(result[1].description ?? result[1].type ?? "JMAP request failed."), String(result[1].type ?? "serverError"), method);
    }
    return result[1] as T;
  }

  async upload(blob: Buffer, type = "message/rfc822"): Promise<{ blobId: string; size: number }> {
    const url = resolveTemplateUrl(this.session.uploadUrl, { accountId: this.mailAccountId });
    const response = await fetchSameOrigin(url, this.origin, {
      method: "POST",
      headers: { Authorization: this.auth.header(), "Content-Type": type },
      body: new Uint8Array(blob),
    });
    if (!response.ok) throw new ToolError(`Upload failed (${response.status}).`, "uploadFailed");
    return await response.json() as { blobId: string; size: number };
  }

  downloadUrl(blobId: string, name: string, type?: string): string {
    const url = resolveTemplateUrl(this.session.downloadUrl, {
      accountId: this.mailAccountId,
      blobId,
      name,
    });
    if (!type) return url;
    const parsed = new URL(url);
    parsed.searchParams.set("type", type);
    return parsed.toString();
  }

  async download(blobId: string, name: string, maxBytes: number): Promise<{ bytes: Buffer; type: string }> {
    const response = await fetchSameOrigin(this.downloadUrl(blobId, name), this.origin, {
      headers: { Authorization: this.auth.header() },
    });
    if (!response.ok) throw new ToolError(`Download failed (${response.status}).`, "downloadFailed");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maxBytes) throw new ToolError(`Attachment is larger than ${maxBytes} bytes.`, "attachmentTooLarge");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new ToolError(`Attachment is larger than ${maxBytes} bytes.`, "attachmentTooLarge");
    return { bytes, type: response.headers.get("content-type") || "application/octet-stream" };
  }

  authorizationHeader(): string {
    return this.auth.header();
  }
}

export function findResponse<T>(responses: JmapResponse["methodResponses"], tag: string): T {
  const response = responses.find((item) => item[2] === tag);
  if (!response) throw new ToolError("The server omitted a requested result.", "emptyResponse");
  if (response[0] === "error") throw new ToolError(String(response[1].description ?? response[1].type), String(response[1].type), response[0]);
  return response[1] as T;
}

export function isAppPassword(secret: string | undefined): boolean {
  return !!secret && secret.startsWith("app_");
}

export function authFromHttpHeader(authorization: string): AuthProvider {
  if (authorization.toLowerCase().startsWith("basic ")) return { header: () => authorization };
  if (authorization.toLowerCase().startsWith("bearer ")) return new BearerAuthProvider(authorization.slice(7).trim());
  throw new ToolError("Authorization must be Bearer or Basic.", "authenticationFailed");
}

export function authFromHeadersOrConfig(authorization: string | undefined, username?: string, token?: string, password?: string): AuthProvider {
  if (authorization) return authFromHttpHeader(authorization);
  const secret = password || token;
  if (password || isAppPassword(secret)) {
    if (!username) {
      throw new ToolError("Set BEARMAIL_USERNAME to the mailbox address when using an app password.", "authenticationFailed");
    }
    return new BasicAuthProvider(username, secret!);
  }
  if (token) return new BearerAuthProvider(token);
  throw new ToolError("Provide an app password or bearer token.", "authenticationFailed");
}
