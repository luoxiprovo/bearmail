import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, FileText, Paperclip, Send, Trash2, X } from "lucide-react";
import { useApp } from "../app-context";
import { destroyEmail, getEmail, saveDraft, sendDraft } from "../jmap/mail";
import type { DraftInput, Email } from "../types";
import { useLocationState, useNavigate } from "../router";

interface ReplyState { replyTo?: Email; replyAll?: boolean }

export function ComposePage({ draftId: routeDraftId }: { draftId?: string }) {
  const locationState = useLocationState<ReplyState>();
  const reply = locationState?.replyTo;
  const replyAll = locationState?.replyAll;
  const { client, mailboxes, identities, notify } = useApp();
  const navigate = useNavigate();
  const identity = identities[0];
  const draftMailbox = mailboxes.find((box) => box.role === "drafts");
  const [input, setInput] = useState<DraftInput>(() => ({
    to: reply ? (replyAll ? [...(reply.from ?? []), ...(reply.to ?? [])] : reply.from ?? []).map((item) => item.email).filter(Boolean).join(", ") : "",
    cc: replyAll ? reply?.cc?.map((item) => item.email).filter(Boolean).join(", ") : "",
    subject: reply ? `${/^re:/i.test(reply.subject ?? "") ? "" : "Re: "}${reply.subject ?? ""}` : "",
    body: reply ? `\n\nOn ${new Date(reply.receivedAt).toLocaleString()}, ${reply.from?.[0]?.name || reply.from?.[0]?.email || "someone"} wrote:\n> ${reply.preview ?? ""}` : "",
  }));
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draftId, setDraftId] = useState(routeDraftId);
  const [saveState, setSaveState] = useState<"unsaved" | "saving" | "saved" | "error">("unsaved");
  const [sending, setSending] = useState(false);
  const loadedDraft = useRef(false);

  useEffect(() => {
    if (!routeDraftId || !client || loadedDraft.current) return;
    loadedDraft.current = true;
    getEmail(client, routeDraftId).then((email) => {
      const textPart = email.textBody?.find((part) => part.partId && email.bodyValues?.[part.partId]);
      setInput({
        to: email.to?.map((item) => item.email).filter(Boolean).join(", ") ?? "",
        cc: email.cc?.map((item) => item.email).filter(Boolean).join(", ") ?? "",
        subject: email.subject ?? "",
        body: textPart?.partId ? email.bodyValues?.[textPart.partId]?.value ?? "" : email.preview ?? "",
      });
      setSaveState("saved");
    }).catch((error) => notify(error instanceof Error ? error.message : "Draft could not be opened.", "error"));
  }, [client, notify, routeDraftId]);

  useEffect(() => {
    if (!client || !identity || !draftMailbox || (!input.to && !input.subject && !input.body && !attachments.length)) return;
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
  }, [attachments, client, draftMailbox, identity, input, notify]); // draftId intentionally excluded to avoid a save loop

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (saveState === "saving" || saveState === "unsaved") event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [saveState]);

  const update = (field: keyof DraftInput, value: string) => setInput((current) => ({ ...current, [field]: value }));
  const close = () => {
    if ((saveState === "saving" || saveState === "unsaved") && !confirm("This draft is still saving. Close the composer?")) return;
    navigate(-1);
  };
  const discard = async () => {
    if (!confirm("Discard this draft?")) return;
    try { if (draftId && client) await destroyEmail(client, draftId); navigate("/mail"); }
    catch (error) { notify(error instanceof Error ? error.message : "The draft could not be discarded.", "error"); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !identity || !draftMailbox || sending) return;
    if (!input.to.trim()) { notify("Add at least one recipient.", "error"); return; }
    setSending(true);
    try {
      const id = await saveDraft(client, input, identity, draftMailbox.id, draftId, attachments);
      await sendDraft(client, id, identity.id);
      notify("Message sent", "success"); navigate("/mail");
    } catch (error) { notify(error instanceof Error ? error.message : "Message could not be sent. Your draft is safe.", "error"); setSending(false); }
  };

  if (!identity || !draftMailbox) return <div className="empty-state"><FileText size={38} /><h2>Sending is unavailable</h2><p>This account needs a sending identity and a Drafts mailbox.</p></div>;
  return (
    <form className="compose-page" onSubmit={submit}>
      <header className="compose-header"><button type="button" className="icon-text-button" onClick={close}><ArrowLeft size={18} /> Close</button><div><span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to Drafts" : saveState === "error" ? "Save failed" : "Unsaved"}</span><button className="primary-button" disabled={sending}><Send size={17} /> {sending ? "Sending…" : "Send"}</button></div></header>
      <div className="compose-sheet">
        <div className="compose-title"><p className="eyebrow">NEW MESSAGE</p><h1>{input.subject || "Write something worth reading"}</h1></div>
        <label className="compose-field"><span>From</span><input disabled value={`${identity.name} <${identity.email}>`} /></label>
        <label className="compose-field"><span>To</span><input autoFocus required placeholder="name@example.com" value={input.to} onChange={(event) => update("to", event.target.value)} /></label>
        <label className="compose-field"><span>Cc</span><input placeholder="Optional" value={input.cc ?? ""} onChange={(event) => update("cc", event.target.value)} /></label>
        <label className="compose-field"><span>Subject</span><input placeholder="Subject" value={input.subject} onChange={(event) => update("subject", event.target.value)} /></label>
        <textarea className="compose-body" aria-label="Message body" placeholder="Start writing…" value={input.body} onChange={(event) => update("body", event.target.value)} />
        {attachments.length > 0 && <div className="compose-attachments">{attachments.map((file, index) => <span key={`${file.name}-${file.lastModified}`}><Paperclip size={15} /><b>{file.name}</b><small>{formatSize(file.size)}</small><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></span>)}</div>}
        <footer className="compose-footer"><label className="attachment-picker"><Paperclip size={17} /> Attach files<input type="file" multiple onChange={(event) => { setAttachments((items) => [...items, ...Array.from(event.target.files ?? [])]); event.target.value = ""; }} /></label><button type="button" className="discard-button" onClick={() => void discard()}><Trash2 size={17} /> Discard</button></footer>
      </div>
    </form>
  );
}

function formatSize(bytes: number): string { return bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
