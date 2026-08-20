const AUTH_KEY = "stalwart.auth";

export type StoredAuth =
  | { type: "basic"; server: string; username: string; password: string }
  | {
    type: "oauth";
    server: string;
    username: string;
    accessToken: string;
    refreshToken?: string;
    tokenEndpoint?: string;
    clientId?: string;
  };

export function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (parsed?.type === "basic" && parsed.server && parsed.username && parsed.password) return parsed;
    if (parsed?.type === "oauth" && parsed.server && parsed.accessToken) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  sessionStorage.setItem("stalwart.server", auth.server);
  sessionStorage.setItem("stalwart.username", auth.username);
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem("stalwart.server");
  sessionStorage.removeItem("stalwart.username");
}
