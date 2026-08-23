import { CAPABILITIES, type JmapMethodCall, type JmapMethodResponse, type JmapResponse, type JmapSession } from "../types";
import { normalizeServerUrl, resolveTemplateUrl } from "../config";

export interface AuthProvider {
  header(): string;
}

export class BasicAuthProvider implements AuthProvider {
  constructor(private readonly username: string, private readonly password: string) {}

  header(): string {
    const bytes = new TextEncoder().encode(`${this.username}:${this.password}`);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return `Basic ${btoa(binary)}`;
  }
}

export class BearerAuthProvider implements AuthProvider {
  constructor(private readonly token: string) {}
  header(): string { return `Bearer ${this.token}`; }
}

export class JmapError extends Error {
  constructor(
    message: string,
    readonly type: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "JmapError";
  }
}

function ensureHttpUrl(value: string, name: string): void {
  const url = new URL(value);
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) throw new Error(`The server returned an insecure ${name} URL.`);
}

export async function discoverSession(serverInput: string, auth: AuthProvider): Promise<{ origin: string; session: JmapSession }> {
  const origin = normalizeServerUrl(serverInput);
  const options: RequestInit = {
    headers: { Authorization: auth.header(), Accept: "application/json" },
    cache: "no-store",
  };
  let response = await fetch(`${origin}/.well-known/jmap`, options);
  if (response.status === 404) response = await fetch(`${origin}/jmap/session`, options);
  if (new URL(response.url).origin !== new URL(origin).origin) {
    throw new JmapError("JMAP discovery redirected to another origin. Enter that server address directly to confirm it.", "crossOriginRedirect");
  }
  if (response.status === 401 || response.status === 403) throw new JmapError("The server rejected those credentials.", "authenticationFailed");
  if (!response.ok) throw new JmapError(`JMAP discovery failed (${response.status}).`, "discoveryFailed");

  const session = await response.json() as JmapSession;
  if (!session.apiUrl || !session.accounts || !session.primaryAccounts) {
    throw new JmapError("The server returned an incomplete JMAP session.", "invalidSession");
  }
  ensureHttpUrl(session.apiUrl, "API");
  ensureHttpUrl(session.uploadUrl, "upload");
  ensureHttpUrl(session.downloadUrl, "download");
  if (session.eventSourceUrl) ensureHttpUrl(session.eventSourceUrl, "event source");
  return { origin, session };
}

export class JmapClient {
  constructor(
    readonly session: JmapSession,
    private auth: AuthProvider,
  ) {}

  replaceAuth(auth: AuthProvider): void {
    this.auth = auth;
  }

  get mailAccountId(): string {
    return this.session.primaryAccounts[CAPABILITIES.mail] ?? this.firstAccountId;
  }

  get calendarAccountId(): string {
    return this.session.primaryAccounts[CAPABILITIES.calendars] ?? this.mailAccountId;
  }

  get firstAccountId(): string {
    const id = Object.keys(this.session.accounts)[0];
    if (!id) throw new JmapError("No account is available to this user.", "accountNotFound");
    return id;
  }

  has(capability: string): boolean {
    return capability in this.session.capabilities || Object.values(this.session.accounts)
      .some((account) => capability in account.accountCapabilities);
  }

  async request(using: string[], methodCalls: JmapMethodCall[], signal?: AbortSignal): Promise<JmapResponse> {
    const response = await fetch(this.session.apiUrl, {
      method: "POST",
      headers: {
        Authorization: this.auth.header(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ using: [...new Set([CAPABILITIES.core, ...using])], methodCalls }),
      signal,
    });
    if (response.status === 401) throw new JmapError("Your session has expired.", "authenticationFailed");
    if (!response.ok) throw new JmapError(`The server request failed (${response.status}).`, "httpError");
    return await response.json() as JmapResponse;
  }

  async call<T>(
    capability: string | string[],
    method: string,
    arguments_: Record<string, unknown>,
    tag = "0",
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request(Array.isArray(capability) ? capability : [capability], [[method, arguments_, tag]], signal);
    const result = response.methodResponses[0];
    if (!result) throw new JmapError("The server returned no response.", "emptyResponse");
    if (result[0] === "error") {
      const details = result[1];
      throw new JmapError(String(details.description ?? details.type ?? "JMAP request failed."), String(details.type ?? "serverError"), details);
    }
    return result[1] as T;
  }

  async upload(accountId: string, blob: Blob): Promise<{ accountId: string; blobId: string; type: string; size: number }> {
    const url = resolveTemplateUrl(this.session.uploadUrl, { accountId });
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: this.auth.header(), "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!response.ok) throw new JmapError(`Upload failed (${response.status}).`, "uploadFailed");
    return await response.json();
  }

  downloadUrl(accountId: string, blobId: string, name: string, type?: string): string {
    const url = resolveTemplateUrl(this.session.downloadUrl, { accountId, blobId, name });
    if (!type) return url;
    const parsed = new URL(url);
    parsed.searchParams.set("type", type);
    return parsed.toString();
  }

  authorizationHeader(): string { return this.auth.header(); }
}

export function findResponse<T>(responses: JmapMethodResponse[], tag: string): T {
  const response = responses.find((item) => item[2] === tag);
  if (!response) throw new JmapError("The server omitted a requested result.", "emptyResponse");
  if (response[0] === "error") throw new JmapError(String(response[1].description ?? response[1].type), String(response[1].type), response[1]);
  return response[1] as T;
}
