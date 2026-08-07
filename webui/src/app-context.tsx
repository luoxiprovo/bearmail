import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadRuntimeConfig } from "./config";
import { BasicAuthProvider, JmapClient, JmapError, discoverSession } from "./jmap/client";
import { getCalendars, getParticipantIdentities } from "./jmap/calendar";
import { getIdentities, getMailboxes } from "./jmap/mail";
import { CAPABILITIES, type Calendar, type Identity, type Mailbox, type ParticipantIdentity, type RuntimeConfig, type ToastMessage } from "./types";
import { beginOAuth, completeOAuthCallback } from "./jmap/oauth";

interface AppContextValue {
  config: RuntimeConfig | null;
  client: JmapClient | null;
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
      if (!nextClient.has(CAPABILITIES.mail)) throw new JmapError("This account does not advertise JMAP Mail.", "missingCapability");
      setClient(nextClient);
      setServerOrigin(discovered.origin);
      setUsername(discovered.session.username || name.trim());
      sessionStorage.setItem("stalwart.server", discovered.origin);
      sessionStorage.setItem("stalwart.username", discovered.session.username || name.trim());
      await refreshClient(nextClient);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new JmapError("The browser could not reach JMAP. Check the server URL, TLS certificate, and CORS allow-list.", "networkError");
      }
      throw error;
    }
  }, [refreshClient]);

  const connectOAuth = useCallback(async (server: string) => {
    await beginOAuth(server, config?.appName ?? "Stalwart Mail");
  }, [config?.appName]);

  useEffect(() => {
    if (!config || window.location.pathname !== "/login") return;
    completeOAuthCallback().then(async (result) => {
      if (!result) return;
      if (!result.client.has(CAPABILITIES.mail)) throw new JmapError("This account does not advertise JMAP Mail.", "missingCapability");
      setClient(result.client); setServerOrigin(result.origin); setUsername(result.username);
      sessionStorage.setItem("stalwart.server", result.origin); sessionStorage.setItem("stalwart.username", result.username);
      await refreshClient(result.client);
      history.replaceState(null, "", "/mail"); window.dispatchEvent(new PopStateEvent("popstate"));
    }).catch((error) => {
      setOauthError(error instanceof Error ? error.message : "OAuth sign-in failed.");
      history.replaceState(null, "", "/connect"); window.dispatchEvent(new PopStateEvent("popstate"));
    });
  }, [config, refreshClient]);

  const logout = useCallback(() => {
    setClient(null);
    setMailboxes([]);
    setCalendars([]);
    setIdentities([]);
    setParticipantIdentities([]);
    setLastSync(null);
    sessionStorage.removeItem("stalwart.server");
    sessionStorage.removeItem("stalwart.username");
  }, []);

  useEffect(() => {
    if (!client || !config) return;
    const interval = window.setInterval(() => {
      if (navigator.onLine) refreshClient(client, true).catch(() => undefined);
    }, Math.max(15, config.pollIntervalSeconds) * 1000);
    return () => window.clearInterval(interval);
  }, [client, config, refreshClient]);

  const value = useMemo<AppContextValue>(() => ({
    config, client, serverOrigin, username, mailboxes, calendars, identities, participantIdentities,
    loadingData, lastSync, syncVersion, online, toasts, oauthError, connect, connectOAuth, logout, refresh, notify,
  }), [config, client, serverOrigin, username, mailboxes, calendars, identities, participantIdentities, loadingData, lastSync, syncVersion, online, toasts, oauthError, connect, connectOAuth, logout, refresh, notify]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
