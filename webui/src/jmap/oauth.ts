import { normalizeServerUrl } from "../config";
import { BearerAuthProvider, JmapClient, JmapError, discoverSession } from "./client";

interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported?: string[];
}

interface PendingOAuth {
  server: string;
  state: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  tokenEndpoint: string;
}

const pendingKey = "stalwart.oauth.pending";
const scope = "openid offline_access urn:ietf:params:oauth:scope:mail urn:ietf:params:oauth:scope:calendars";

export async function beginOAuth(serverInput: string, appName: string): Promise<void> {
  const server = normalizeServerUrl(serverInput);
  const metadataResponse = await fetch(`${server}/.well-known/oauth-authorization-server`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!metadataResponse.ok) throw new JmapError("This server did not publish OAuth metadata.", "oauthUnavailable");
  const metadata = await metadataResponse.json() as OAuthMetadata;
  if (!metadata.code_challenge_methods_supported?.includes("S256")) throw new JmapError("This server does not advertise secure PKCE authentication.", "oauthPkceUnavailable");
  const redirectUri = `${window.location.origin}/login`;
  const registrationEndpoint = new URL(metadata.registration_endpoint, server).toString();
  const registration = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: appName,
      client_uri: window.location.origin,
      application_type: "web",
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      scope,
    }),
  });
  if (!registration.ok) throw new JmapError("OAuth client registration is disabled. Ask the administrator to register this UI or use an app password.", "oauthRegistrationFailed");
  const registered = await registration.json() as { client_id?: string; error_description?: string };
  if (!registered.client_id) throw new JmapError(registered.error_description ?? "OAuth client registration failed.", "oauthRegistrationFailed");
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const pending: PendingOAuth = {
    server, state, verifier, clientId: registered.client_id, redirectUri,
    tokenEndpoint: new URL(metadata.token_endpoint, server).toString(),
  };
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  const authorization = new URL(metadata.authorization_endpoint, server);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("client_id", pending.clientId);
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("scope", scope);
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  window.location.assign(authorization.toString());
}

type OAuthSession = {
  origin: string;
  client: JmapClient;
  username: string;
  accessToken: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  clientId?: string;
};

let callbackPromise: Promise<OAuthSession | null> | null = null;

export function completeOAuthCallback(): Promise<OAuthSession | null> {
  callbackPromise ??= finishOAuthCallback();
  return callbackPromise;
}

async function finishOAuthCallback(): Promise<OAuthSession | null> {
  if (window.location.pathname !== "/login") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const oauthError = params.get("error");
  if (oauthError) throw new JmapError(params.get("error_description") ?? `OAuth failed: ${oauthError}`, oauthError);
  if (!code) return null;
  const rawPending = sessionStorage.getItem(pendingKey);
  if (!rawPending) throw new JmapError("The OAuth sign-in request has expired. Start again.", "oauthStateMissing");
  const pending = JSON.parse(rawPending) as PendingOAuth;
  sessionStorage.removeItem(pendingKey);
  if (!returnedState || returnedState !== pending.state) throw new JmapError("The OAuth response did not match this browser session.", "oauthStateMismatch");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  const tokenResponse = await fetch(pending.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new JmapError(token.error_description ?? token.error ?? "The authorization code could not be exchanged.", "oauthTokenFailed");
  const auth = new BearerAuthProvider(token.access_token);
  const discovered = await discoverSession(pending.server, auth);
  return {
    origin: discovered.origin,
    client: new JmapClient(discovered.session, auth),
    username: discovered.session.username,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenEndpoint: pending.tokenEndpoint,
    clientId: pending.clientId,
  };
}

export async function refreshOAuthAccessToken(input: { tokenEndpoint: string; clientId: string; refreshToken: string }): Promise<{ accessToken: string; refreshToken?: string }> {
  const tokenResponse = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
    }),
  });
  const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new JmapError(token.error_description ?? token.error ?? "The saved session expired. Sign in again.", "oauthRefreshFailed");
  return { accessToken: token.access_token, refreshToken: token.refresh_token };
}

function randomUrlSafe(bytes: number): string { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return base64Url(value); }
function base64Url(value: ArrayBuffer | Uint8Array): string { const bytes = value instanceof Uint8Array ? value : new Uint8Array(value); let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
