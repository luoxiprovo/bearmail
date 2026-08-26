import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Ban, CalendarDays, ChevronRight, Inbox, LoaderCircle, Mail, MailOpen, OctagonAlert, Paperclip, Search, Star, Trash2 } from "lucide-react";
import { useApp } from "../app-context";
import { findCalendarInvitationPart, getEmails, patchEmail, patchEmails } from "../jmap/mail";
import { blockSender, emailIsInMailbox, markEmailAsNotSpam, markEmailAsSpam, senderAddress } from "../jmap/spam";
import type { Email, Mailbox } from "../types";
import { useNavigate } from "../router";

export function MailPage({ mailboxId, autoFocusSearch = false }: { mailboxId?: string; autoFocusSearch?: boolean }) {
  const { client, mailboxes, notify, refresh, syncVersion } = useApp();
  const navigate = useNavigate();
  const activeMailbox = useMemo(() => mailboxes.find((box) => box.id === mailboxId) ?? mailboxes.find((box) => box.role === "inbox") ?? mailboxes[0], [mailboxId, mailboxes]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      setSelected((current) => new Set([...current].filter((id) => page.emails.some((email) => email.id === id))));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "Mail could not be loaded.", "error");
    } finally { setLoading(false); }
  }, [activeMailbox, client, notify, search, syncVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setSelected(new Set()); }, [activeMailbox?.id, search]);

  const action = async (email: Email, patch: Record<string, unknown>, success: string) => {
    if (!client) return;
    const original = emails;
    try { await patchEmail(client, email.id, patch); notify(success, "success"); await refresh(); await load(); }
    catch (error) { setEmails(original); notify(error instanceof Error ? error.message : "The action failed.", "error"); }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = emails.length > 0 && emails.every((email) => selected.has(email.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(emails.map((email) => email.id)));
  };

  const markSelected = async (seen: boolean) => {
    if (!client || !selected.size) return;
    const ids = [...selected];
    try {
      await patchEmails(client, ids, { "keywords/$seen": seen ? true : null });
      notify(seen ? `Marked ${ids.length === 1 ? "message" : `${ids.length} messages`} read` : `Marked ${ids.length === 1 ? "message" : `${ids.length} messages`} unread`, "success");
      setSelected(new Set());
      await refresh();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The messages could not be updated.", "error");
    }
  };

  const archive = mailboxes.find((box) => box.role === "archive");
  const trash = mailboxes.find((box) => box.role === "trash");
  const junk = mailboxes.find((box) => box.role === "junk");
  const inbox = mailboxes.find((box) => box.role === "inbox");
  const viewingJunk = activeMailbox?.role === "junk";

  const reportSpam = async (email: Email, block: boolean) => {
    if (!client || !junk) return;
    try {
      await markEmailAsSpam(client, email, junk.id);
      if (block) {
        const sender = senderAddress(email);
        try {
          if (sender) await blockSender(client, sender);
          notify(sender ? `Marked as spam and blocked ${sender}` : "Marked as spam", "success");
        } catch (error) {
          notify(error instanceof Error ? `${error.message} The message was still moved to Junk.` : "Moved to Junk. The sender could not be blocked.", "error");
        }
      } else {
        notify("Marked as spam", "success");
      }
      await refresh();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The message could not be marked as spam.", "error");
    }
  };

  const reportNotSpam = async (email: Email) => {
    if (!client || !inbox) {
      notify("This account has no Inbox mailbox, so the message cannot be moved out of Junk.", "error");
      return;
    }
    try {
      await markEmailAsNotSpam(client, email, inbox.id);
      notify("Marked as not spam", "success");
      await refresh();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The message could not be marked as not spam.", "error");
    }
  };

  const reportSelectedSpam = async (block: boolean) => {
    if (!client || !junk || !selected.size) return;
    const chosen = emails.filter((email) => selected.has(email.id));
    try {
      for (const email of chosen) await markEmailAsSpam(client, email, junk.id);
      if (block) {
        const senders = [...new Set(chosen.map(senderAddress).filter(Boolean))];
        try {
          for (const sender of senders) await blockSender(client, sender);
          notify(senders.length ? `Marked as spam and blocked ${senders.length === 1 ? senders[0] : `${senders.length} senders`}` : "Marked as spam", "success");
        } catch (error) {
          notify(error instanceof Error ? `${error.message} The messages were still moved to Junk.` : "Moved to Junk. The sender could not be blocked.", "error");
        }
      } else {
        notify("Marked as spam", "success");
      }
      setSelected(new Set());
      await refresh();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The messages could not be marked as spam.", "error");
    }
  };

  const reportSelectedNotSpam = async () => {
    if (!client || !inbox || !selected.size) return;
    const chosen = emails.filter((email) => selected.has(email.id));
    try {
      for (const email of chosen) await markEmailAsNotSpam(client, email, inbox.id);
      notify(chosen.length === 1 ? "Marked as not spam" : `Moved ${chosen.length} messages to Inbox`, "success");
      setSelected(new Set());
      await refresh();
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The messages could not be marked as not spam.", "error");
    }
  };
  const unreadCount = search ? emails.filter((email) => !email.keywords?.["$seen"]).length : (activeMailbox?.unreadEmails ?? emails.filter((email) => !email.keywords?.["$seen"]).length);
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
        <div className="list-meta">
          <label className="select-all">
            <input type="checkbox" checked={allSelected} disabled={!emails.length} onChange={toggleAll} aria-label="Select all messages" />
            <span>{total ? `${total.toLocaleString()} conversation${total === 1 ? "" : "s"}` : "No conversations"}{unreadCount ? ` · ${unreadCount} unread` : ""}</span>
          </label>
          <span>Newest first</span>
        </div>
        {selected.size > 0 && (
          <div className="mail-bulk-bar" role="toolbar" aria-label="Selected messages">
            <span>{selected.size} selected</span>
            <button type="button" onClick={() => void markSelected(true)}><MailOpen size={16} /> Mark read</button>
            <button type="button" onClick={() => void markSelected(false)}><Mail size={16} /> Mark unread</button>
            {viewingJunk && inbox && <button type="button" onClick={() => void reportSelectedNotSpam()}><Inbox size={16} /> Not spam</button>}
            {!viewingJunk && junk && <button type="button" onClick={() => void reportSelectedSpam(false)}><OctagonAlert size={16} /> Spam</button>}
            {!viewingJunk && junk && <button type="button" onClick={() => void reportSelectedSpam(true)}><Ban size={16} /> Block</button>}
            <button type="button" className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
        {loading ? <div className="empty-state"><LoaderCircle className="spin" /><p>Loading messages…</p></div> : emails.length === 0 ? (
          <div className="empty-state"><MailOpen size={38} /><h2>Nothing here</h2><p>{search ? "Try a broader search." : "This mailbox is comfortably empty."}</p></div>
        ) : <div className="email-list" role="list">
          {emails.map((email) => {
            const unread = !email.keywords?.["$seen"];
            const invited = Boolean(findCalendarInvitationPart(email));
            return (
              <article key={email.id} role="listitem" tabIndex={0} className={`email-row ${unread ? "unread" : ""} ${selected.has(email.id) ? "selected" : ""}`} onClick={() => navigate(`/mail/message/${email.id}`)} onKeyDown={(event) => { if (event.key === "Enter") navigate(`/mail/message/${email.id}`); }}>
                <input type="checkbox" checked={selected.has(email.id)} aria-label={`Select ${email.subject || "message"}`} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(email.id)} />
                <button className={`star-button ${email.keywords?.["$flagged"] ? "selected" : ""}`} aria-label={email.keywords?.["$flagged"] ? "Unstar" : "Star"} onClick={(event) => { event.stopPropagation(); void action(email, { "keywords/$flagged": email.keywords?.["$flagged"] ? null : true }, "Star updated"); }}><Star size={17} /></button>
                <div className="email-main"><div className="email-line"><strong>{formatSender(email)}</strong><time>{formatMailDate(email.receivedAt)}</time></div><div className="email-subject">{email.subject || "(no subject)"}</div><p>{email.preview || "No preview available"}</p></div>
                <div className="email-markers">{invited && <span title="Calendar invitation"><CalendarDays size={15} /></span>}{email.hasAttachment && <Paperclip size={15} />}</div>
                <div className="row-actions">
                  <button aria-label={unread ? "Mark as read" : "Mark as unread"} onClick={(event) => { event.stopPropagation(); void action(email, { "keywords/$seen": unread ? true : null }, unread ? "Marked read" : "Marked unread"); }}>{unread ? <MailOpen size={16} /> : <Mail size={16} />}</button>
                  {archive && !emailIsInMailbox(email, junk?.id) && <button aria-label="Archive" onClick={(event) => { event.stopPropagation(); void action(email, { [`mailboxIds/${activeMailbox?.id}`]: null, [`mailboxIds/${archive.id}`]: true }, "Archived"); }}><Archive size={16} /></button>}
                  {emailIsInMailbox(email, junk?.id)
                    ? inbox && <button aria-label="Mark as not spam" onClick={(event) => { event.stopPropagation(); void reportNotSpam(email); }}><Inbox size={16} /></button>
                    : junk && <>
                      <button aria-label="Mark as spam" onClick={(event) => { event.stopPropagation(); void reportSpam(email, false); }}><OctagonAlert size={16} /></button>
                      <button aria-label="Mark as spam and block sender" onClick={(event) => { event.stopPropagation(); void reportSpam(email, true); }}><Ban size={16} /></button>
                    </>}
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
