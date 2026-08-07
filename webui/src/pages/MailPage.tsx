import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, ChevronRight, Inbox, LoaderCircle, MailOpen, Paperclip, Search, Star, Trash2 } from "lucide-react";
import { useApp } from "../app-context";
import { getEmails, patchEmail } from "../jmap/mail";
import type { Email, Mailbox } from "../types";
import { useNavigate } from "../router";

export function MailPage({ mailboxId, autoFocusSearch = false }: { mailboxId?: string; autoFocusSearch?: boolean }) {
  const { client, mailboxes, notify, syncVersion } = useApp();
  const navigate = useNavigate();
  const activeMailbox = useMemo(() => mailboxes.find((box) => box.id === mailboxId) ?? mailboxes.find((box) => box.role === "inbox") ?? mailboxes[0], [mailboxId, mailboxes]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!client || (!activeMailbox && !search)) return;
    setLoading(true);
    try {
      const page = await getEmails(client, { mailboxId: search ? undefined : activeMailbox?.id, text: search || undefined, signal });
      setEmails(page.emails); setTotal(page.total);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "Mail could not be loaded.", "error");
    } finally { setLoading(false); }
  }, [activeMailbox, client, notify, search, syncVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const action = async (email: Email, patch: Record<string, unknown>, success: string) => {
    if (!client) return;
    const original = emails;
    setEmails((items) => items.map((item) => item.id === email.id ? { ...item, keywords: { ...item.keywords, ...(patch["keywords/$flagged"] === true ? { "$flagged": true } : {}) } } : item));
    try { await patchEmail(client, email.id, patch); notify(success, "success"); await load(); }
    catch (error) { setEmails(original); notify(error instanceof Error ? error.message : "The action failed.", "error"); }
  };

  const archive = mailboxes.find((box) => box.role === "archive");
  const trash = mailboxes.find((box) => box.role === "trash");
  return (
    <div className="mail-layout">
      <aside className="mailbox-panel">
        <div className="panel-heading"><span>Mailboxes</span><small>{mailboxes.reduce((sum, box) => sum + (box.unreadEmails ?? 0), 0)} unread</small></div>
        <div className="mailbox-list">
          {mailboxes.map((box) => <MailboxLink key={box.id} box={box} active={box.id === activeMailbox?.id && !search} onClick={() => navigate(`/mail/${box.id}`)} />)}
        </div>
      </aside>
      <section className="message-list-panel">
        <header className="page-header mail-header">
          <div><p className="eyebrow">MAIL</p><h1>{search ? "Search results" : activeMailbox?.name ?? "Mail"}</h1></div>
          <div className="search-box"><Search size={18} /><input autoFocus={autoFocusSearch} aria-label="Search mail" placeholder="Search mail" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery("")}>Clear</button>}</div>
        </header>
        <div className="list-meta"><span>{total ? `${total.toLocaleString()} conversation${total === 1 ? "" : "s"}` : "No conversations"}</span><span>Newest first</span></div>
        {loading ? <div className="empty-state"><LoaderCircle className="spin" /><p>Loading messages…</p></div> : emails.length === 0 ? (
          <div className="empty-state"><MailOpen size={38} /><h2>Nothing here</h2><p>{search ? "Try a broader search." : "This mailbox is comfortably empty."}</p></div>
        ) : <div className="email-list" role="list">
          {emails.map((email) => {
            const unread = !email.keywords?.["$seen"];
            const invited = email.attachments?.some((part) => part.type?.toLowerCase().startsWith("text/calendar"));
            return (
              <article key={email.id} role="listitem" tabIndex={0} className={`email-row ${unread ? "unread" : ""}`} onClick={() => navigate(`/mail/message/${email.id}`)} onKeyDown={(event) => { if (event.key === "Enter") navigate(`/mail/message/${email.id}`); }}>
                <button className={`star-button ${email.keywords?.["$flagged"] ? "selected" : ""}`} aria-label={email.keywords?.["$flagged"] ? "Unstar" : "Star"} onClick={(event) => { event.stopPropagation(); void action(email, { "keywords/$flagged": email.keywords?.["$flagged"] ? null : true }, "Star updated"); }}><Star size={17} /></button>
                <div className="email-main"><div className="email-line"><strong>{formatSender(email)}</strong><time>{formatMailDate(email.receivedAt)}</time></div><div className="email-subject">{email.subject || "(no subject)"}</div><p>{email.preview || "No preview available"}</p></div>
                <div className="email-markers">{invited && <span title="Calendar invitation"><CalendarDays size={15} /></span>}{email.hasAttachment && <Paperclip size={15} />}</div>
                <div className="row-actions">
                  {archive && <button aria-label="Archive" onClick={(event) => { event.stopPropagation(); void action(email, { [`mailboxIds/${activeMailbox?.id}`]: null, [`mailboxIds/${archive.id}`]: true }, "Archived"); }}><Archive size={16} /></button>}
                  {trash && <button aria-label="Move to trash" onClick={(event) => { event.stopPropagation(); const patch: Record<string, unknown> = { [`mailboxIds/${trash.id}`]: true }; Object.keys(email.mailboxIds).forEach((id) => { if (id !== trash.id) patch[`mailboxIds/${id}`] = null; }); void action(email, patch, "Moved to trash"); }}><Trash2 size={16} /></button>}
                </div>
                <ChevronRight className="row-chevron" size={17} />
              </article>
            );
          })}
        </div>}
      </section>
    </div>
  );
}

function MailboxLink({ box, active, onClick }: { box: Mailbox; active: boolean; onClick(): void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{box.role === "inbox" && <Inbox size={16} />}{box.name}</span>{Boolean(box.unreadEmails) && <b>{box.unreadEmails}</b>}</button>;
}

function formatSender(email: Email): string {
  const sender = email.from?.[0];
  return sender?.name || sender?.email || "Unknown sender";
}

function formatMailDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: "short", day: "numeric" });
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
