import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Forward, Image as ImageIcon, LoaderCircle, Paperclip, Reply, ReplyAll, Trash2 } from "lucide-react";
import { useApp } from "../app-context";
import { sanitizeEmailHtml } from "../emailHtml";
import { findCalendarInvitationPart, getEmail, patchEmail } from "../jmap/mail";
import type { Email, EmailBodyPart } from "../types";
import { InvitationCard } from "../components/InvitationCard";
import { useNavigate } from "../router";

export function MessagePage({ emailId }: { emailId: string }) {
  const { client, mailboxes, notify } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowImages, setAllowImages] = useState(false);

  useEffect(() => {
    if (!client || !emailId) return;
    setLoading(true);
    getEmail(client, emailId).then((message) => {
      setEmail(message);
      if (!message.keywords?.["$seen"]) void patchEmail(client, message.id, { "keywords/$seen": true });
    }).catch((error) => notify(error instanceof Error ? error.message : "Message could not be loaded.", "error")).finally(() => setLoading(false));
  }, [client, emailId, notify]);

  const body = useMemo(() => getBody(email, allowImages), [email, allowImages]);
  if (loading) return <div className="page-loading"><LoaderCircle className="spin" /> Loading message…</div>;
  if (!email) return <div className="empty-state"><h2>Message unavailable</h2><button onClick={() => navigate("/mail")}>Back to mail</button></div>;
  const calendarAttachment = findCalendarInvitationPart(email);
  const trash = mailboxes.find((box) => box.role === "trash");
  const recipients = (email.to ?? []).map(formatAddress).join(", ");

  const remove = async () => {
    if (!client || !trash) return;
    try {
      const patch: Record<string, unknown> = { [`mailboxIds/${trash.id}`]: true };
      Object.keys(email.mailboxIds).forEach((id) => { if (id !== trash.id) patch[`mailboxIds/${id}`] = null; });
      await patchEmail(client, email.id, patch); notify("Moved to trash", "success"); navigate("/mail");
    } catch (error) { notify(error instanceof Error ? error.message : "The message could not be moved.", "error"); }
  };

  return (
    <article className="message-page">
      <header className="message-toolbar">
        <button className="icon-text-button" onClick={() => navigate(-1)}><ArrowLeft size={18} /> Back</button>
        <div><button className="icon-button" aria-label="Reply" onClick={() => navigate("/mail/compose", { state: { replyTo: email } })}><Reply size={18} /></button><button className="icon-button" aria-label="Reply all" onClick={() => navigate("/mail/compose", { state: { replyTo: email, replyAll: true } })}><ReplyAll size={18} /></button><button className="icon-button" aria-label="Forward" onClick={() => navigate("/mail/compose", { state: { forward: email } })}><Forward size={18} /></button>{trash && <button className="icon-button" aria-label="Move to trash" onClick={() => void remove()}><Trash2 size={18} /></button>}</div>
      </header>
      <div className="message-content">
        <p className="eyebrow">MESSAGE</p><h1>{email.subject || "(no subject)"}</h1>
        <div className="sender-block"><div className="avatar">{initials(email.from?.[0]?.name || email.from?.[0]?.email)}</div><div><strong>{formatAddress(email.from?.[0])}</strong><span>to {recipients || "me"}</span></div><time>{new Date(email.receivedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time></div>
        {!allowImages && body.hasRemoteImages && <button className="remote-images" onClick={() => setAllowImages(true)}><ImageIcon size={17} /> Remote images are blocked. Load them once.</button>}
        {calendarAttachment && <InvitationCard attachment={calendarAttachment} />}
        {body.html ? <iframe className="email-frame" title="Message body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={body.html} /> : <pre className="plain-body">{body.text || email.preview}</pre>}
        {Boolean(email.attachments?.length) && <section className="attachments"><h2><Paperclip size={18} /> Attachments</h2><div>{email.attachments?.map((attachment, index) => <AttachmentButton key={`${attachment.blobId}-${index}`} part={attachment} />)}</div></section>}
        <div className="message-end-actions"><button className="secondary-button" onClick={() => navigate("/mail/compose", { state: { replyTo: email } })}><Reply size={17} /> Reply</button><button className="secondary-button" onClick={() => navigate("/mail/compose", { state: { replyTo: email, replyAll: true } })}><ReplyAll size={17} /> Reply all</button><button className="secondary-button" onClick={() => navigate("/mail/compose", { state: { forward: email } })}><Forward size={17} /> Forward</button></div>
      </div>
    </article>
  );
}

function AttachmentButton({ part }: { part: EmailBodyPart }) {
  const { client, notify } = useApp();
  const download = async () => {
    if (!client || !part.blobId) return;
    try {
      const response = await fetch(client.downloadUrl(client.mailAccountId, part.blobId, part.name || "attachment", part.type), { headers: { Authorization: client.authorizationHeader() } });
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = part.name || "attachment"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notify(error instanceof Error ? error.message : "Download failed.", "error"); }
  };
  return <button onClick={() => void download()}><span><Download size={17} /><b>{part.name || (part.type?.startsWith("text/calendar") ? "calendar invitation.ics" : "attachment")}</b></span><small>{part.size ? formatSize(part.size) : part.type}</small></button>;
}

function getBody(email: Email | null, allowImages: boolean): { html: string; text: string; hasRemoteImages: boolean } {
  if (!email) return { html: "", text: "", hasRemoteImages: false };
  const htmlPart = email.htmlBody?.find((part) => part.partId && email.bodyValues?.[part.partId]);
  const textPart = email.textBody?.find((part) => part.partId && email.bodyValues?.[part.partId]);
  const rawHtml = htmlPart?.partId ? email.bodyValues?.[htmlPart.partId]?.value ?? "" : "";
  const text = textPart?.partId ? email.bodyValues?.[textPart.partId]?.value ?? "" : "";
  if (!rawHtml) return { html: "", text, hasRemoteImages: false };
  const sanitized = sanitizeEmailHtml(rawHtml, {
    allowImages,
    stripExternalRsvp: Boolean(findCalendarInvitationPart(email)),
  });
  return { html: sanitized.html, text, hasRemoteImages: sanitized.hasRemoteImages };
}

function formatAddress(address?: { name?: string; email?: string }): string { return address?.name ? `${address.name} <${address.email}>` : address?.email || "Unknown sender"; }
function initials(value?: string): string { return (value || "?").split(/[\s@]+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function formatSize(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
