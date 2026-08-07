import { useApp } from "./app-context";
import { ConnectionPage } from "./pages/ConnectionPage";
import { MailPage } from "./pages/MailPage";
import { MessagePage } from "./pages/MessagePage";
import { ComposePage } from "./pages/ComposePage";
import { CalendarPage } from "./pages/CalendarPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppShell } from "./components/AppShell";
import { useNavigate, usePath } from "./router";
import { useEffect } from "react";

export default function App() {
  const { config, client } = useApp();
  const path = usePath();
  if (!config) return <div className="boot"><span className="brand-mark">S</span><span>Opening your workspace…</span></div>;
  if (!client) return <ConnectionPage />;
  let page;
  if (path.startsWith("/mail/message/")) page = <MessagePage emailId={decodeURIComponent(path.slice("/mail/message/".length))} />;
  else if (path.startsWith("/mail/compose")) page = <ComposePage draftId={decodeURIComponent(path.split("/")[3] ?? "")} />;
  else if (path === "/calendar") page = <CalendarPage />;
  else if (path === "/search") page = <MailPage autoFocusSearch />;
  else if (path === "/settings") page = <SettingsPage />;
  else if (path === "/diagnostics") page = <SettingsPage diagnostics />;
  else if (path === "/" || path === "/connect" || path.startsWith("/mail")) page = <MailPage mailboxId={path.split("/")[2] ? decodeURIComponent(path.split("/")[2]) : undefined} />;
  else page = <Redirect to="/mail" />;
  return (
    <AppShell>{page}</AppShell>
  );
}

function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return null;
}
