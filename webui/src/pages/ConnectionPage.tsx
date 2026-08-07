import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CalendarCheck2, Check, KeyRound, LockKeyhole, Mail, Server, ShieldCheck } from "lucide-react";
import { useApp } from "../app-context";
import { useNavigate } from "../router";

export function ConnectionPage() {
  const { config, serverOrigin, username: rememberedUsername, connect, connectOAuth, oauthError } = useApp();
  const [server, setServer] = useState(serverOrigin || config?.defaultServerUrl || "");
  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(oauthError);
  const navigate = useNavigate();
  useEffect(() => { document.title = `${config?.appName ?? "Stalwart Mail"} — Connect`; }, [config]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await connect(server, username, password);
      navigate("/mail");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection failed.");
    } finally { setBusy(false); }
  };

  const oauth = async () => {
    setBusy(true); setError("");
    try { await connectOAuth(server); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "OAuth sign-in failed."); setBusy(false); }
  };

  return (
    <div className="connect-page">
      <section className="connect-story">
        <div className="brand brand-light"><span className="brand-mark">S</span><span>{config?.appName}</span></div>
        <div className="story-copy">
          <p className="eyebrow">YOUR MAIL. YOUR CALENDAR. YOUR SERVER.</p>
          <h1>A calmer place for the work that arrives.</h1>
          <p>Read mail, plan your week, and answer invitations without handing your day to another cloud.</p>
          <div className="story-points">
            <span><Mail size={19} /><b>Focused mail</b><small>Fast JMAP search and clean conversations</small></span>
            <span><CalendarCheck2 size={19} /><b>Invites in context</b><small>Respond once, see the calendar update</small></span>
            <span><ShieldCheck size={19} /><b>Private by default</b><small>No analytics, trackers, or third-party fonts</small></span>
          </div>
        </div>
        <p className="connect-footnote">An independent web client for Stalwart</p>
      </section>
      <section className="connect-form-wrap">
        <form className="connect-form" onSubmit={submit}>
          <p className="eyebrow coral">CONNECT YOUR ACCOUNT</p>
          <h2>Welcome back</h2>
          <p className="form-intro">Enter the address of your Stalwart server and your account credentials.</p>
          <label>Mail server <span className="input-shell"><Server size={18} /><input required inputMode="url" placeholder="https://mail.example.com" value={server} onChange={(event) => setServer(event.target.value)} readOnly={!config?.allowCustomServers} /></span></label>
          {config?.allowOAuth && <button type="button" className="oauth-button" disabled={busy || !server.trim()} onClick={() => void oauth()}><KeyRound size={18} /> Continue with Stalwart <ArrowRight size={17} /></button>}
          {config?.allowOAuth && config.allowBasicAuth && <div className="form-separator"><span>or use an app password</span></div>}
          {config?.allowBasicAuth && <>
          <label>Email or account name <span className="input-shell"><Mail size={18} /><input required autoComplete="username" placeholder="you@example.com" value={username} onChange={(event) => setUsername(event.target.value)} /></span></label>
          <label>App password <span className="input-shell"><LockKeyhole size={18} /><input required type="password" autoComplete="current-password" placeholder="Session only" value={password} onChange={(event) => setPassword(event.target.value)} /></span></label>
          </>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {config?.allowBasicAuth && <button className="primary-button connect-submit" disabled={busy}>{busy ? "Connecting…" : "Connect with app password"}<ArrowRight size={18} /></button>}
          <p className="privacy-note"><Check size={15} /> Your password stays in this browser tab and is never written to storage.</p>
        </form>
      </section>
    </div>
  );
}
