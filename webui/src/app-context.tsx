import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadRuntimeConfig } from "./config";
import { BasicAuthProvider, BearerAuthProvider, JmapClient, JmapError, discoverSession } from "./jmap/client";
import { getCalendars, getParticipantIdentities } from "./jmap/calendar";
import { getIdentities, getMailboxes } from "./jmap/mail";
import { completeOAuthCallback, beginOAuth, refreshOAuthAccessToken } from "./jmap/oauth";
import { clearStoredAuth, loadStoredAuth, saveStoredAuth, type StoredAuth } from "./session";
import { CAPABILITIES, type Calendar, type Identity, type Mailbox, type ParticipantIdentity, type RuntimeConfig, type ToastMessage } from "./types";

interface AppContextValue {
  config: RuntimeConfig | null;
  client: JmapClient | null;
  sessionReady: boolean;
  serverOrigin: string;
  username: string;
  mailboxes: Mailbox[];
  calendars: Calendar[];
  identities: Identity[];
  participantIdentities: ParticipantIdentity[];
  loadingData: boolean;
  lastSync: Date | null;
  syncVersion: number;
  online: boolean;
  toasts: ToastMessage[];
  oauthError: string;
  connect(server: string, username: string, password: string): Promise<void>;
  connectOAuth(server: string): Promise<void>;
  logout(): void;
  refresh(): Promise<void>;
  notify(text: string, tone?: ToastMessage["tone"]): void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [client, setClient] = useState<JmapClient | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [serverOrigin, setServerOrigin] = useState(() => sessionStorage.getItem("stalwart.server") ?? "");
  const [username, setUsername] = useState(() => sessionStorage.getItem("stalwart.username") ?? "");
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [participantIdentities, setParticipantIdentities] = useState<ParticipantIdentity[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [oauthError, setOauthError] = useState("");
  const toastId = useRef(0);

  useEffect(() => { loadRuntimeConfig().then(setConfig); }, []);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((items) => [...items, { id, text, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4500);
  }, []);

  const refreshClient = useCallback(async (nextClient: JmapClient, quiet = false) => {
    if (!quiet) setLoadingData(true);
    try {
      const optionalTasks: Promise<unknown>[] = [];
      if (nextClient.has(CAPABILITIES.mail)) {
        setMailboxes(await getMailboxes(nextClient));
        if (nextClient.has(CAPABILITIES.submission)) optionalTasks.push(getIdentities(nextClient).then(setIdentities));
      }
      if (nextClient.has(CAPABILITIES.calendars)) {
        optionalTasks.push(getCalendars(nextClient).then(setCalendars));
        optionalTasks.push(getParticipantIdentities(nextClient).then(setParticipantIdentities));
      }
      await Promise.allSettled(optionalTasks);
      setLastSync(new Date());
      setSyncVersion((value) => value + 1);
    } finally {
      setLoadingData(false);
    }
  }, []);

  const applySession = useCallback(async (nextClient: JmapClient, origin: string, name: string) => {
    if (!nextClient.has(CAPABILITIES.mail)) throw new JmapError("This account does not advertise JMAP Mail.", "missingCapability");
    setClient(nextClient);
    setServerOrigin(origin);
    setUsername(name);
    sessionStorage.setItem("stalwart.server", origin);
    sessionStorage.setItem("stalwart.username", name);
    await refreshClient(nextClient);
  }, [refreshClient]);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      await refreshClient(client);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Refresh failed.", "error");
    }
  }, [client, notify, refreshClient]);

  const connect = useCallback(async (server: string, name: string, password: string) => {
    if (!password) throw new JmapError("Enter your password or app password.", "missingCredentials");
    try {
      const auth = new BasicAuthProvider(name.trim(), password);
      const discovered = await discoverSession(server, auth);
      const nextClient = new JmapClient(discovered.session, auth);
      const username = discovered.session.username || name.trim();
      await applySession(nextClient, discovered.origin, username);
      saveStoredAuth({ type: "basic", server: discovered.origin, username, password });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new JmapError("The browser could not reach JMAP. Check the server URL, TLS certificate, and CORS allow-list.", "networkError");
      }
      throw error;
    }
  }, [applySession]);

  const connectOAuth = useCallback(async (server: string) => {
    await beginOAuth(server, config?.appName ?? "Stalwart Mail");
  }, [config?.appName]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const restore = async () => {
      try {
        if (window.location.pathname === "/login") {
          const result = await completeOAuthCallback();
          if (result) {
            await applySession(result.client, result.origin, result.username);
            saveStoredAuth({
              type: "oauth",
              server: result.origin,
              username: result.username,
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
              tokenEndpoint: result.tokenEndpoint,
              clientId: result.clientId,
            });
            history.replaceState(null, "", "/mail");
            window.dispatchEvent(new PopStateEvent("popstate"));
            return;
          }
        }
        const stored = loadStoredAuth();
        if (!stored) return;
        if (stored.type === "basic") {
          const auth = new BasicAuthProvider(stored.username, stored.password);
          const discovered = await discoverSession(stored.server, auth);
          await applySession(new JmapClient(discovered.session, auth), discovered.origin, discovered.session.username || stored.username);
          return;
        }
        let accessToken = stored.accessToken;
        let refreshToken = stored.refreshToken;
        const trySession = async (token: string) => {
          const auth = new BearerAuthProvider(token);
          const discovered = await discoverSession(stored.server, auth);
          await applySession(new JmapClient(discovered.session, auth), discovered.origin, discovered.session.username || stored.username);
        };
        try {
          await trySession(accessToken);
        } catch (error) {
          if (!(error instanceof JmapError && error.type === "authenticationFailed") || !stored.refreshToken || !stored.tokenEndpoint || !stored.clientId) throw error;
          const refreshed = await refreshOAuthAccessToken({ tokenEndpoint: stored.tokenEndpoint, clientId: stored.clientId, refreshToken: stored.refreshToken });
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken ?? refreshToken;
          await trySession(accessToken);
          saveStoredAuth({ ...stored, accessToken, refreshToken });
        }
      } catch (error) {
        const failedAuth = error instanceof JmapError && (error.type === "authenticationFailed" || error.type.startsWith("oauth"));
        if (failedAuth) clearStoredAuth();
        if (window.location.pathname === "/login") {
          setOauthError(error instanceof Error ? error.message : "OAuth sign-in failed.");
          history.replaceState(null, "", "/connect");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [applySession, config]);

  const logout = useCallback(() => {
    setClient(null);
    setMailboxes([]);
    setCalendars([]);
    setIdentities([]);
    setParticipantIdentities([]);
    setLastSync(null);
    clearStoredAuth();
  }, []);

  useEffect(() => {
    if (!client || !config) return;
    const interval = window.setInterval(() => {
      if (navigator.onLine) refreshClient(client, true).catch(() => undefined);
    }, Math.max(15, config.pollIntervalSeconds) * 1000);
    return () => window.clearInterval(interval);
  }, [client, config, refreshClient]);

  const value = useMemo<AppContextValue>(() => ({
    config, client, sessionReady, serverOrigin, username, mailboxes, calendars, identities, participantIdentities,
    loadingData, lastSync, syncVersion, online, toasts, oauthError, connect, connectOAuth, logout, refresh, notify,
  }), [config, client, sessionReady, serverOrigin, username, mailboxes, calendars, identities, participantIdentities, loadingData, lastSync, syncVersion, online, toasts, oauthError, connect, connectOAuth, logout, refresh, notify]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
