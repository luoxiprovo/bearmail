import { CalendarDays, CircleUserRound, Inbox, LogOut, MailPlus, RefreshCw, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../app-context";
import { NavLink, useNavigate } from "../router";

export function AppShell({ children }: { children: ReactNode }) {
  const { config, client, mailboxes, username, online, lastSync, loadingData, refresh, logout, toasts } = useApp();
  const navigate = useNavigate();
  const signOut = () => { logout(); navigate("/connect"); };
  const unreadMail = mailboxes.find((box) => box.role === "inbox")?.unreadEmails
    ?? mailboxes.reduce((sum, box) => sum + (box.unreadEmails ?? 0), 0);
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand"><span className="brand-mark">B</span><span>{config?.appName}</span></div>
        {client?.has("urn:ietf:params:jmap:submission") && <NavLink to="/mail/compose" className="compose-nav"><MailPlus size={19} /> Compose</NavLink>}
        <nav>
          <NavLink to="/mail"><Inbox size={18} /> Mail{unreadMail ? <b className="unread-count" aria-label={`${unreadMail} unread`}>{formatUnread(unreadMail)}</b> : null}</NavLink>
          {client?.has("urn:ietf:params:jmap:calendars") && <NavLink to="/calendar"><CalendarDays size={18} /> Calendar</NavLink>}
          <NavLink to="/settings"><Settings size={18} /> Settings</NavLink>
        </nav>
        <div className="sidebar-foot">
          <button className="account-button" onClick={() => navigate("/settings")}>
            <CircleUserRound size={22} /> <span><strong>{username}</strong><small>{online ? "Connected" : "Offline"}</small></span>
          </button>
          <div className="sync-row">
            <span className={`status-dot ${online ? "online" : ""}`} />
            <span>{lastSync ? `Synced ${formatRelative(lastSync)}` : "Connecting"}</span>
            <button className="icon-button" aria-label="Refresh" onClick={() => void refresh()} disabled={loadingData}>
              <RefreshCw size={15} className={loadingData ? "spin" : ""} />
            </button>
          </div>
          <button className="quiet-button" onClick={signOut}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>
      <main className="workspace">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/mail"><Inbox size={21} /><span>Mail{unreadMail ? ` (${formatUnread(unreadMail)})` : ""}</span></NavLink>
        {client?.has("urn:ietf:params:jmap:calendars") && <NavLink to="/calendar"><CalendarDays size={21} /><span>Calendar</span></NavLink>}
        {client?.has("urn:ietf:params:jmap:submission") && <NavLink to="/mail/compose" className="mobile-compose"><MailPlus size={23} /><span>Compose</span></NavLink>}
        <NavLink to="/search"><Search size={21} /><span>Search</span></NavLink>
        <NavLink to="/settings"><Settings size={21} /><span>Settings</span></NavLink>
      </nav>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>)}
      </div>
    </div>
  );
}

function formatRelative(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function formatUnread(count: number): string {
  return count > 99 ? "99+" : String(count);
}
