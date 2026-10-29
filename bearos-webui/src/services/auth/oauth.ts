/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { getApiBaseUrl } from '@/services/api';
import { getBasePath } from '@/lib/basePath';
import { resolveOAuthClientId } from '@/lib/oauthClientId';
import { useAuthStore } from '@/stores/authStore';
import i18n from '@/i18n';

const SCOPES_OVERRIDE = import.meta.env.VITE_OAUTH_SCOPES as string | undefined;

const SESSION_PREFIX = 'stalwart-oauth-';

export interface DiscoveryResponse {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  stalwart_required_scopes?: string[];
}

export function selectScopes(
  discovery: Pick<DiscoveryResponse, 'scopes_supported' | 'stalwart_required_scopes'>,
  override: string | undefined = SCOPES_OVERRIDE,
): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  const required = discovery.stalwart_required_scopes;
  if (Array.isArray(required)) {
    return required.filter((scope) => typeof scope === 'string' && scope.length > 0).join(' ');
  }
  return discovery.scopes_supported?.includes('openid') ? 'openid' : '';
}

export async function discover(username: string): Promise<DiscoveryResponse> {
  const url = `${getApiBaseUrl()}/api/discover/${encodeURIComponent(username)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      i18n.t('oauth.discoveryFailed', 'Discovery failed for "{{username}}": {{status}} {{statusText}}', {
        username,
        status: response.status,
        statusText: response.statusText,
      }),
    );
  }
  return response.json() as Promise<DiscoveryResponse>;
}

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error(`code_verifier length must be 43-128, got ${length}`);
  }

  const out: string[] = [];
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i];
      if (b < 198) {
        out.push(UNRESERVED[b % 66]);
      }
    }
  }
  return out.join('');
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  }
  const { sha256: fallback } = await import('@noble/hashes/sha2.js');
  return fallback(data);
}

export async function generateCodeChallenge(verifier: string): Promise<{ challenge: string; method: 'S256' }> {
  const digest = await sha256(new TextEncoder().encode(verifier));
  return { challenge: base64UrlEncode(digest), method: 'S256' };
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join('');
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  tokenEndpoint: string,
  redirectUri: string,
  clientId: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(
      i18n.t('oauth.tokenExchangeFailed', 'Token exchange failed: {{status}} {{statusText}}', {
        status: response.status,
        statusText: response.statusText,
      }),
    );
  }

  return response.json() as Promise<TokenResponse>;
}

function getRedirectUri(): string {
  const basePath = getBasePath();
  return `${window.location.origin}${basePath}/oauth/callback`;
}

export function resolveRegistrationEndpoint(endpoint: string, origin: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  const base = origin.replace(/\/+$/, '');
  if (trimmed.startsWith('/')) return `${base}${trimmed}`;
  return new URL(trimmed, `${base}/`).toString();
}

async function registerPublicClient(registrationEndpoint: string, redirectUri: string, scope: string): Promise<string> {
  const response = await fetch(resolveRegistrationEndpoint(registrationEndpoint, window.location.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: 'BearOS',
      client_uri: window.location.origin,
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      ...(scope ? { scope } : {}),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    client_id?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.client_id) {
    const detail = body.error_description || body.error || `${response.status} ${response.statusText}`;
    throw new Error(
      i18n.t('oauth.registrationFailed', 'Could not register this admin UI for sign-in: {{detail}}', { detail }),
    );
  }
  return body.client_id;
}

export async function startAuthFlow(username: string, returnUrl?: string | null): Promise<void> {
  const discovery = await discover(username);
  const { authorization_endpoint, token_endpoint, end_session_endpoint, revocation_endpoint } = discovery;
  const scope = selectScopes(discovery);

  let clientId = resolveOAuthClientId(discovery.client_id_metadata_document_supported === true);
  if (!clientId) {
    const registrationEndpoint = discovery.registration_endpoint?.trim();
    if (!registrationEndpoint) {
      throw new Error(
        i18n.t(
          'oauth.clientIdUnavailable',
          'Sign-in is not configured: the identity provider does not support client metadata documents and no OAuth client id is configured for this application.',
        ),
      );
    }
    clientId = await registerPublicClient(registrationEndpoint, getRedirectUri(), scope);
  }

  const codeVerifier = generateCodeVerifier();
  const { challenge: codeChallenge, method: codeChallengeMethod } = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  const candidate = returnUrl ?? window.location.pathname + window.location.search;
  const basePath = getBasePath();
  const stripped = candidate.startsWith(basePath) ? candidate.slice(basePath.length) : candidate;
  const isAuthPath =
    stripped === '/login' ||
    stripped.startsWith('/login?') ||
    stripped === '/oauth/callback' ||
    stripped.startsWith('/oauth/callback?');
  const safeReturnUrl = isAuthPath ? '' : candidate;

  sessionStorage.setItem(`${SESSION_PREFIX}code_verifier`, codeVerifier);
  sessionStorage.setItem(`${SESSION_PREFIX}token_endpoint`, token_endpoint);
  sessionStorage.setItem(`${SESSION_PREFIX}state`, state);
  sessionStorage.setItem(`${SESSION_PREFIX}return_url`, safeReturnUrl);
  sessionStorage.setItem(`${SESSION_PREFIX}client_id`, clientId);
  if (end_session_endpoint) {
    sessionStorage.setItem(`${SESSION_PREFIX}end_session_endpoint`, end_session_endpoint);
  } else {
    sessionStorage.removeItem(`${SESSION_PREFIX}end_session_endpoint`);
  }
  if (revocation_endpoint) {
    sessionStorage.setItem(`${SESSION_PREFIX}revocation_endpoint`, revocation_endpoint);
  } else {
    sessionStorage.removeItem(`${SESSION_PREFIX}revocation_endpoint`);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
    login_hint: username,
    prompt: 'login',
  });

  if (scope) {
    params.set('scope', scope);
  }

  window.location.href = `${authorization_endpoint}?${params.toString()}`;
}

export function getStoredOAuthData() {
  return {
    codeVerifier: sessionStorage.getItem(`${SESSION_PREFIX}code_verifier`),
    tokenEndpoint: sessionStorage.getItem(`${SESSION_PREFIX}token_endpoint`),
    state: sessionStorage.getItem(`${SESSION_PREFIX}state`),
    returnUrl: sessionStorage.getItem(`${SESSION_PREFIX}return_url`),
    endSessionEndpoint: sessionStorage.getItem(`${SESSION_PREFIX}end_session_endpoint`),
    revocationEndpoint: sessionStorage.getItem(`${SESSION_PREFIX}revocation_endpoint`),
    clientId: sessionStorage.getItem(`${SESSION_PREFIX}client_id`),
  };
}

export function clearStoredOAuthData(): void {
  sessionStorage.removeItem(`${SESSION_PREFIX}code_verifier`);
  sessionStorage.removeItem(`${SESSION_PREFIX}token_endpoint`);
  sessionStorage.removeItem(`${SESSION_PREFIX}state`);
  sessionStorage.removeItem(`${SESSION_PREFIX}return_url`);
  sessionStorage.removeItem(`${SESSION_PREFIX}end_session_endpoint`);
  sessionStorage.removeItem(`${SESSION_PREFIX}revocation_endpoint`);
  sessionStorage.removeItem(`${SESSION_PREFIX}client_id`);
}

export function getOAuthRedirectUri(): string {
  return getRedirectUri();
}

export function getPostLogoutRedirectUri(): string {
  const basePath = getBasePath();
  return `${window.location.origin}${basePath}/login`;
}

export function buildEndSessionUrl(endSessionEndpoint: string, postLogoutRedirectUri: string): string | null {
  const { clientId } = useAuthStore.getState();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
  const sep = endSessionEndpoint.includes('?') ? '&' : '?';
  return `${endSessionEndpoint}${sep}${params.toString()}`;
}

export function revokeSessionTokens(): void {
  const { revocationEndpoint, clientId, refreshToken, accessToken } = useAuthStore.getState();
  const token = refreshToken || accessToken;
  if (!revocationEndpoint || !clientId || !token) return;
  const body = new URLSearchParams({
    token,
    token_type_hint: refreshToken ? 'refresh_token' : 'access_token',
    client_id: clientId,
  });
  fetch(revocationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
