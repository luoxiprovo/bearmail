import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, KeyRound, LogOut, Moon, RefreshCw, Server, Sun, Trash2 } from "lucide-react";
import { useApp } from "../app-context";
import { changeAccountPassword, validateNewPassword } from "../jmap/account";
import { createAccountApiKey, listAccountApiKeys, revokeAccountApiKey, type AccountApiKey } from "../jmap/apiKeys";
import { RichTextEditor } from "../components/RichTextEditor";
import { identitySignatureHtml, SIGNATURE_MAX_LENGTH, updateIdentitySignatures } from "../jmap/mail";
import { fileToCompressedDataUrl, htmlToPlainText } from "../richtext";
import { CAPABILITIES } from "../types";
import { useNavigate } from "../router";

export function SettingsPage({ diagnostics = false }: { diagnostics?: boolean }) {
  const { client, serverOrigin, username, lastSync, online, refresh, logout, notify } = useApp();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem("stalwart.theme") ?? "light");
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("stalwart.theme", theme); }, [theme]);
  if (!client) return null;
  const capabilities = [
    ["Mail", CAPABILITIES.mail], ["Sending", CAPABILITIES.submission], ["Calendars", CAPABILITIES.calendars], ["Invite parsing", CAPABILITIES.calendarsParse], ["Filters", CAPABILITIES.sieve],
  ] as const;
  const copyDiagnostics = async () => {
    const report = { serverOrigin, username, online, sessionState: client.session.state, capabilities: capabilities.map(([name, id]) => ({ name, available: client.has(id) })), userAgent: navigator.userAgent };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); notify("Diagnostics copied", "success");
  };
  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{diagnostics ? "SUPPORT" : "PREFERENCES"}</p>
          <h1>{diagnostics ? "Connection diagnostics" : "Settings"}</h1>
          <p>{diagnostics ? "Non-secret details that can help an administrator diagnose setup." : "A few practical controls, kept deliberately simple."}</p>
        </div>
      </header>
      <div className="settings-grid">
        {!diagnostics && <section>
          <h2>Appearance</h2>
          <p>Choose the theme used on this device.</p>
          <div className="theme-choice">
            <button aria-pressed={theme === "light"} className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={18} /> Light</button>
            <button aria-pressed={theme === "dark"} className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={18} /> Dark</button>
          </div>
        </section>}
        <section>
          <h2>Account</h2>
          <dl>
            <div><dt>Signed in as</dt><dd>{username}</dd></div>
            <div><dt>Mail server</dt><dd>{serverOrigin}</dd></div>
            <div><dt>Connection</dt><dd><span className={`status-dot ${online ? "online" : ""}`} />{online ? "Online" : "Offline"}</dd></div>
            <div><dt>Last refresh</dt><dd>{lastSync?.toLocaleString() ?? "Not yet"}</dd></div>
          </dl>
          <div className="settings-actions">
            <button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16} /> Refresh now</button>
            <button className="secondary-button" onClick={() => { logout(); navigate("/connect"); }}><LogOut size={16} /> Sign out</button>
          </div>
        </section>
        {!diagnostics && <PasswordSettings />}
        {!diagnostics && <ApiKeySettings />}
        {!diagnostics && <SignatureSettings />}
        <section>
          <h2>JMAP capabilities</h2>
          <p>Features are enabled from the authenticated server session.</p>
          <ul className="capability-list">{capabilities.map(([name, id]) => <li key={id} className={client.has(id) ? "available" : "missing"}><CheckCircle2 size={17} /><span><b>{name}</b><small>{client.has(id) ? "Available" : "Not advertised"}</small></span></li>)}</ul>
        </section>
        <section>
          <h2>Privacy</h2>
          <p>This client includes no analytics, ad code, third-party fonts, or telemetry. Message bodies are loaded on demand.</p>
          <button className="text-button" onClick={() => navigate("/diagnostics")}><Server size={16} /> Open diagnostics</button>
        </section>
        {diagnostics && <section className="diagnostics-card">
          <h2>Support report</h2>
          <p>The copied report excludes credentials, tokens, message content, and calendar content.</p>
          <button className="primary-button" onClick={() => void copyDiagnostics()}><Copy size={16} /> Copy diagnostics</button>
        </section>}
      </div>
    </div>
  );
}

function PasswordSettings() {
  const { client, rememberPassword, notify } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  if (!client?.has(CAPABILITIES.stalwart)) return null;
  const save = async () => {
    setSaving(true);
    try {
      validateNewPassword(currentPassword, newPassword, confirmPassword);
      await changeAccountPassword(client, currentPassword, newPassword);
      rememberPassword(newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify("Password updated", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The password could not be changed.", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="password-settings">
      <h2>Password</h2>
      <p>Change the password for this mail account. You will stay signed in on this device.</p>
      <label>
        <span>Current password</span>
        <input aria-label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>
      <label>
        <span>New password</span>
        <input aria-label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
      </label>
      <label>
        <span>Confirm new password</span>
        <input aria-label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
      </label>
      <div className="signature-actions">
        <small>At least 8 characters. The server may require a stronger password.</small>
        <button className="primary-button" disabled={saving} onClick={() => void save()}><KeyRound size={16} />{saving ? "Saving…" : "Change password"}</button>
      </div>
    </section>
  );
}

function formatWhen(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ApiKeySettings() {
  const { client, notify } = useApp();
  const [keys, setKeys] = useState<AccountApiKey[]>([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; description: string; secret: string } | null>(null);
  const listRequest = useRef(0);

  const reload = async () => {
    if (!client) return;
    const request = ++listRequest.current;
    const next = await listAccountApiKeys(client);
    if (request === listRequest.current) setKeys(next);
  };

  useEffect(() => {
    if (!client?.has(CAPABILITIES.stalwart)) return;
    let cancelled = false;
    setLoading(true);
    const request = ++listRequest.current;
    listAccountApiKeys(client)
      .then((next) => {
        if (!cancelled && request === listRequest.current) setKeys(next);
      })
      .catch((error: unknown) => {
        if (!cancelled && request === listRequest.current) {
          notify(error instanceof Error ? error.message : "API keys could not be loaded.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, notify]);

  if (!client?.has(CAPABILITIES.stalwart)) return null;

  const generate = async () => {
    setCreating(true);
    try {
      const created = await createAccountApiKey(client, description);
      setRevealed({ id: created.id, description: description.trim(), secret: created.secret });
      setDescription("");
      notify("API key created. Copy it now.", "success");
      try {
        await reload();
      } catch (error) {
        notify(error instanceof Error ? error.message : "API keys could not be loaded.", "error");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "The API key could not be created.", "error");
    } finally {
      setCreating(false);
    }
  };

  const copySecret = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.secret);
      notify("API key copied", "success");
    } catch {
      notify("Select the key and copy it.", "error");
    }
  };

  const revoke = async (key: AccountApiKey) => {
    if (!window.confirm(`Revoke “${key.description}”? Tools using this key will stop working.`)) return;
    setRevokingId(key.id);
    try {
      await revokeAccountApiKey(client, key.id);
      if (revealed?.id === key.id) setRevealed(null);
      notify("API key revoked", "success");
      try {
        await reload();
      } catch (error) {
        notify(error instanceof Error ? error.message : "API keys could not be loaded.", "error");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "The API key could not be revoked.", "error");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="api-key-settings">
      <h2>API keys</h2>
      <p>Create a key for this account so mail tools and agents can sign in without the BearOS admin site. The key is shown only once and can do what this account can do.</p>
      <label>
        <span>API key name</span>
        <input aria-label="API key name" value={description} maxLength={200} placeholder="Laptop mail client" onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="signature-actions">
        <small>Give each key a name you will recognize later.</small>
        <button className="primary-button" disabled={creating} onClick={() => void generate()}><KeyRound size={16} />{creating ? "Creating…" : "Generate API key"}</button>
      </div>
      {revealed && (
        <div className="api-key-secret">
          <p>Copy the key for {revealed.description}. BearMail will not show it again.</p>
          <input aria-label="New API key" readOnly value={revealed.secret} autoComplete="off" spellCheck={false} />
          <div className="signature-actions">
            <button className="secondary-button" onClick={() => void copySecret()}><Copy size={16} /> Copy API key</button>
            <button className="secondary-button" onClick={() => setRevealed(null)}>I have saved this key</button>
          </div>
        </div>
      )}
      {loading ? <p>Loading API keys…</p> : keys.length === 0 ? <p>No API keys yet.</p> : (
        <ul className="api-key-list">
          {keys.map((key) => {
            const created = formatWhen(key.createdAt);
            const expires = formatWhen(key.expiresAt);
            return (
              <li key={key.id}>
                <div>
                  <b>{key.description}</b>
                  <small>{created ? `Created ${created}` : "Created"}{expires ? ` · Expires ${expires}` : ""}</small>
                </div>
                <button className="danger-button" disabled={revokingId === key.id} onClick={() => void revoke(key)}><Trash2 size={16} />{revokingId === key.id ? "Revoking…" : `Revoke ${key.description}`}</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SignatureSettings() {
  const { client, identities, refresh, notify } = useApp();
  const [identityId, setIdentityId] = useState(identities[0]?.id ?? "");
  const identity = identities.find((item) => item.id === identityId) ?? identities[0];
  const [html, setHtml] = useState(() => identitySignatureHtml(identity));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (identity && !identities.some((item) => item.id === identityId)) setIdentityId(identity.id);
  }, [identities, identity, identityId]);
  useEffect(() => {
    setHtml(identitySignatureHtml(identity));
  }, [identity]);
  if (!identity) return null;
  const text = htmlToPlainText(html);
  const save = async () => {
    if (!client) return;
    setSaving(true);
    try {
      await updateIdentitySignatures(client, identity.id, text.slice(0, SIGNATURE_MAX_LENGTH), html);
      await refresh();
      notify("Signature saved", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The signature could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="signature-settings">
      <h2>Email signature</h2>
      <p>Added below your message on new mail, replies, and forwards. Use the picture button to include a logo or photo.</p>
      {identities.length > 1 && (
        <label className="signature-identity">
          <span>From address</span>
          <select aria-label="Signature identity" value={identity.id} onChange={(event) => setIdentityId(event.target.value)}>
            {identities.map((item) => <option key={item.id} value={item.id}>{item.name ? `${item.name} <${item.email}>` : item.email}</option>)}
          </select>
        </label>
      )}
      <RichTextEditor
        compact
        className="signature-editor"
        value={html}
        onChange={setHtml}
        aria-label="Email signature"
        placeholder={"Jane Doe\nEngineering\nexample.com"}
        onInsertImage={(file) => fileToCompressedDataUrl(file, 180, 0.55)}
      />
      <div className="signature-actions">
        <small>{text.length}/{SIGNATURE_MAX_LENGTH} text · pictures are embedded in the HTML signature</small>
        <button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save signature"}</button>
      </div>
    </section>
  );
}
