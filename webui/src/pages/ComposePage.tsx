import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, FileText, Image as ImageIcon, Paperclip, Send, Trash2, X } from "lucide-react";
import { RichTextEditor, type RichTextEditorHandle } from "../components/RichTextEditor";
import { useApp } from "../app-context";
import {
  composeDraftBody, composeDraftHtml, destroyEmail, draftBodyFromEmail, forwardedMessage, forwardedMessageHtml,
  forwardSubject, getEmail, identitySignatureHtml, identitySignatureText, replyQuote, replyQuoteHtml, replySubject,
  saveDraft, sendDraft,
} from "../jmap/mail";
import { fileToCompressedDataUrl, htmlToPlainText } from "../richtext";
import type { DraftInput, Email } from "../types";
import { useLocationState, useNavigate } from "../router";

interface ComposeState { replyTo?: Email; replyAll?: boolean; forward?: Email }

export function ComposePage({ draftId: routeDraftId }: { draftId?: string }) {
  const locationState = useLocationState<ComposeState>();
  const reply = locationState?.replyTo;
  const replyAll = locationState?.replyAll;
  const forward = locationState?.forward;
  const { client, mailboxes, identities, notify } = useApp();
  const navigate = useNavigate();
  const identity = identities[0];
  const draftMailbox = mailboxes.find((box) => box.role === "drafts");
  const sentMailbox = mailboxes.find((box) => box.role === "sent");
  const unsignedBody = useMemo(
    () => composeDraftBody({
      quoted: !forward && reply ? replyQuote(reply) : undefined,
      forwarded: forward ? forwardedMessage(forward) : undefined,
    }),
    [forward, reply],
  );
  const unsignedHtml = useMemo(
    () => composeDraftHtml({
      quotedHtml: !forward && reply ? replyQuoteHtml(reply) : undefined,
      forwardedHtml: forward ? forwardedMessageHtml(forward) : undefined,
    }),
    [forward, reply],
  );
  const seededBody = useMemo(
    () => composeDraftBody({
      signature: identitySignatureText(identity),
      quoted: !forward && reply ? replyQuote(reply) : undefined,
      forwarded: forward ? forwardedMessage(forward) : undefined,
    }),
    [forward, identity, reply],
  );
  const seededHtml = useMemo(
    () => composeDraftHtml({
      signatureHtml: identitySignatureHtml(identity),
      quotedHtml: !forward && reply ? replyQuoteHtml(reply) : undefined,
      forwardedHtml: forward ? forwardedMessageHtml(forward) : undefined,
    }),
    [forward, identity, reply],
  );
  const [input, setInput] = useState<DraftInput>(() => ({
    to: forward ? "" : reply ? (replyAll ? [...(reply.from ?? []), ...(reply.to ?? [])] : reply.from ?? []).map((item) => item.email).filter(Boolean).join(", ") : "",
    cc: forward ? "" : replyAll ? reply?.cc?.map((item) => item.email).filter(Boolean).join(", ") : "",
    subject: forward ? forwardSubject(forward.subject) : reply ? replySubject(reply.subject) : "",
    body: seededBody,
    htmlBody: seededHtml,
  }));
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draftId, setDraftId] = useState(routeDraftId);
  const [saveState, setSaveState] = useState<"unsaved" | "saving" | "saved" | "error">("unsaved");
  const [sending, setSending] = useState(false);
  const loadedDraft = useRef(false);
  const attachInput = useRef<HTMLInputElement>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    if (routeDraftId || loadedDraft.current) return;
    setInput((current) => current.body === unsignedBody || current.htmlBody === unsignedHtml
      ? { ...current, body: seededBody, htmlBody: seededHtml }
      : current);
  }, [routeDraftId, seededBody, seededHtml, unsignedBody, unsignedHtml]);

  useEffect(() => {
    if (!routeDraftId || !client || loadedDraft.current) return;
    loadedDraft.current = true;
    getEmail(client, routeDraftId).then((email) => {
      const loaded = draftBodyFromEmail(email);
      setInput({
        to: email.to?.map((item) => item.email).filter(Boolean).join(", ") ?? "",
        cc: email.cc?.map((item) => item.email).filter(Boolean).join(", ") ?? "",
        subject: email.subject ?? "",
        body: loaded.body,
        htmlBody: loaded.htmlBody,
      });
      setSaveState("saved");
    }).catch((error) => notify(error instanceof Error ? error.message : "Draft could not be opened.", "error"));
  }, [client, notify, routeDraftId]);

  useEffect(() => {
    if (!client || !identity || !draftMailbox || (!input.to && !input.subject && !attachments.length && input.body === seededBody && (input.htmlBody ?? "") === seededHtml)) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const id = await saveDraft(client, input, identity, draftMailbox.id, draftId, attachments);
        setDraftId(id); setSaveState("saved");
      } catch (error) {
        setSaveState("error"); notify(error instanceof Error ? error.message : "Draft could not be saved.", "error");
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [attachments, client, draftMailbox, identity, input, notify, seededBody, seededHtml]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (saveState === "saving" || saveState === "unsaved") event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [saveState]);

  const update = (field: keyof DraftInput, value: string) => setInput((current) => ({ ...current, [field]: value }));
  const updateHtml = (html: string) => setInput((current) => ({ ...current, htmlBody: html, body: htmlToPlainText(html) }));
  const close = () => {
    if ((saveState === "saving" || saveState === "unsaved") && !confirm("This draft is still saving. Close the composer?")) return;
    navigate(-1);
  };
  const discard = async () => {
    if (!confirm("Discard this draft?")) return;
    try { if (draftId && client) await destroyEmail(client, draftId); navigate("/mail"); }
    catch (error) { notify(error instanceof Error ? error.message : "The draft could not be discarded.", "error"); }
  };
  const addFiles = (files: FileList | File[] | null) => {
    const next = [...(files ?? [])];
    if (!next.length) return;
    setAttachments((items) => [...items, ...next]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !identity || !draftMailbox || !sentMailbox || sending) return;
    if (!input.to.trim()) { notify("Add at least one recipient.", "error"); return; }
    setSending(true);
    try {
      const id = await saveDraft(client, input, identity, draftMailbox.id, draftId, attachments);
      await sendDraft(client, id, identity.id, draftMailbox.id, sentMailbox.id);
      notify("Message sent", "success"); navigate("/mail");
    } catch (error) { notify(error instanceof Error ? error.message : "Message could not be sent. Your draft is safe.", "error"); setSending(false); }
  };

  if (!identity || !draftMailbox || !sentMailbox) return <div className="empty-state"><FileText size={38} /><h2>Sending is unavailable</h2><p>This account needs a sending identity, a Drafts mailbox, and a Sent mailbox.</p></div>;
  return (
    <form className="compose-page" onSubmit={submit}>
      <header className="compose-header">
        <button type="button" className="icon-text-button" onClick={close}><ArrowLeft size={18} /> Close</button>
        <div>
          <span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to Drafts" : saveState === "error" ? "Save failed" : "Unsaved"}</span>
          <button className="primary-button" disabled={sending}><Send size={17} /> {sending ? "Sending…" : "Send"}</button>
        </div>
      </header>
      <div className="compose-sheet">
        <div className="compose-title"><p className="eyebrow">{forward ? "FORWARD" : reply ? "REPLY" : "NEW MESSAGE"}</p><h1>{input.subject || "Write something worth reading"}</h1></div>
        <label className="compose-field"><span>From</span><input disabled value={`${identity.name} <${identity.email}>`} /></label>
        <label className="compose-field"><span>To</span><input autoFocus required placeholder="name@example.com" value={input.to} onChange={(event) => update("to", event.target.value)} /></label>
        <label className="compose-field"><span>Cc</span><input placeholder="Optional" value={input.cc ?? ""} onChange={(event) => update("cc", event.target.value)} /></label>
        <label className="compose-field"><span>Subject</span><input placeholder="Subject" value={input.subject} onChange={(event) => update("subject", event.target.value)} /></label>
        <RichTextEditor
          ref={editorRef}
          className="compose-editor"
          value={input.htmlBody ?? ""}
          onChange={updateHtml}
          onInsertImage={(file) => fileToCompressedDataUrl(file, 720, 0.72)}
        />
        {attachments.length > 0 && <div className="compose-attachments">{attachments.map((file, index) => <span key={`${file.name}-${file.lastModified}`}><Paperclip size={15} /><b>{file.name}</b><small>{formatSize(file.size)}</small><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></span>)}</div>}
        <div className="compose-action-toolbar" role="toolbar" aria-label="Compose actions">
          <button className="primary-button" disabled={sending}><Send size={17} /> {sending ? "Sending…" : "Send"}</button>
          <button type="button" className="secondary-button" onClick={() => attachInput.current?.click()}><Paperclip size={17} /> Attach files</button>
          <button type="button" className="secondary-button" onClick={() => pictureInput.current?.click()}><ImageIcon size={17} /> Add pictures</button>
          <button type="button" className="discard-button" onClick={() => void discard()}><Trash2 size={17} /> Discard</button>
          <input ref={attachInput} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          <input ref={pictureInput} type="file" accept="image/*" multiple hidden onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            for (const file of files) void editorRef.current?.insertImage(file);
          }} />
        </div>
      </div>
    </form>
  );
}

function formatSize(bytes: number): string { return bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
