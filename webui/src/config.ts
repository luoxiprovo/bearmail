import type { RuntimeConfig } from "./types";

export const defaultConfig: RuntimeConfig = {
  appName: "Stalwart Mail",
  defaultServerUrl: "",
  allowCustomServers: true,
  allowBasicAuth: true,
  allowOAuth: true,
  pollIntervalSeconds: 30,
};

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) return defaultConfig;
    return { ...defaultConfig, ...(await response.json()) };
  } catch {
    return defaultConfig;
  }
}

export function normalizeServerUrl(raw: string): string {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = new URL(withProtocol);
  if (url.username || url.password) throw new Error("Remove credentials from the server URL.");
  const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("Use HTTPS for remote servers.");
  }
  return url.origin;
}

export function resolveTemplateUrl(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (url, [key, value]) => url.replaceAll(`{${key}}`, encodeURIComponent(value)),
    template,
  );
}
