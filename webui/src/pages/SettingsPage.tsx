import { useEffect, useState } from "react";
import { CheckCircle2, Copy, LogOut, Moon, RefreshCw, Server, Sun } from "lucide-react";
import { useApp } from "../app-context";
import { CAPABILITIES } from "../types";
import { useNavigate } from "../router";

export function SettingsPage({ diagnostics = false }: { diagnostics?: boolean }) {
  const { client, serverOrigin, username, lastSync, online, refresh, logout, notify } = useApp();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem("stalwart.theme") ?? "light");
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("stalwart.theme", theme); }, [theme]);
  if (!client) return null;
  const capabilities = [
    ["Mail", CAPABILITIES.mail], ["Sending", CAPABILITIES.submission], ["Calendars", CAPABILITIES.calendars], ["Invite parsing", CAPABILITIES.calendarsParse],
  ] as const;
  const copyDiagnostics = async () => {
    const report = { serverOrigin, username, online, sessionState: client.session.state, capabilities: capabilities.map(([name, id]) => ({ name, available: client.has(id) })), userAgent: navigator.userAgent };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); notify("Diagnostics copied", "success");
  };
  return <div className="settings-page"><header className="page-header"><div><p className="eyebrow">{diagnostics ? "SUPPORT" : "PREFERENCES"}</p><h1>{diagnostics ? "Connection diagnostics" : "Settings"}</h1><p>{diagnostics ? "Non-secret details that can help an administrator diagnose setup." : "A few practical controls, kept deliberately simple."}</p></div></header><div className="settings-grid">{!diagnostics && <section><h2>Appearance</h2><p>Choose the theme used on this device.</p><div className="theme-choice"><button aria-pressed={theme === "light"} className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={18} /> Light</button><button aria-pressed={theme === "dark"} className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={18} /> Dark</button></div></section>}<section><h2>Account</h2><dl><div><dt>Signed in as</dt><dd>{username}</dd></div><div><dt>Stalwart server</dt><dd>{serverOrigin}</dd></div><div><dt>Connection</dt><dd><span className={`status-dot ${online ? "online" : ""}`} />{online ? "Online" : "Offline"}</dd></div><div><dt>Last refresh</dt><dd>{lastSync?.toLocaleString() ?? "Not yet"}</dd></div></dl><div className="settings-actions"><button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16} /> Refresh now</button><button className="secondary-button" onClick={() => { logout(); navigate("/connect"); }}><LogOut size={16} /> Sign out</button></div></section><section><h2>JMAP capabilities</h2><p>Features are enabled from the authenticated server session.</p><ul className="capability-list">{capabilities.map(([name, id]) => <li key={id} className={client.has(id) ? "available" : "missing"}><CheckCircle2 size={17} /><span><b>{name}</b><small>{client.has(id) ? "Available" : "Not advertised"}</small></span></li>)}</ul></section><section><h2>Privacy</h2><p>Passwords stay in memory. Message bodies are loaded on demand. This client includes no analytics, ad code, third-party fonts, or telemetry.</p><button className="text-button" onClick={() => navigate("/diagnostics")}><Server size={16} /> Open diagnostics</button></section>{diagnostics && <section className="diagnostics-card"><h2>Support report</h2><p>The copied report excludes credentials, tokens, message content, and calendar content.</p><button className="primary-button" onClick={() => void copyDiagnostics()}><Copy size={16} /> Copy diagnostics</button></section>}</div></div>;
}
