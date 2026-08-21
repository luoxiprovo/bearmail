import { CAPABILITIES, type DraftInput, type Email, type EmailBodyPart, type Identity, type Mailbox } from "../types";
import { JmapClient, JmapError, findResponse } from "./client";

interface GetResult<T> { accountId: string; state: string; list: T[]; notFound?: string[] }
interface QueryResult { accountId: string; queryState: string; canCalculateChanges: boolean; position: number; ids: string[]; total?: number }
interface SetResult { oldState: string; newState: string; updated?: Record<string, null>; destroyed?: string[]; notUpdated?: Record<string, Record<string, unknown>> }

export async function getMailboxes(client: JmapClient): Promise<Mailbox[]> {
  const result = await client.call<GetResult<Mailbox>>(CAPABILITIES.mail, "Mailbox/get", {
    accountId: client.mailAccountId,
    properties: ["id", "name", "parentId", "role", "sortOrder", "totalEmails", "unreadEmails", "myRights"],
  });
  return result.list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export interface EmailPage { emails: Email[]; total: number; queryState: string }

export async function getEmails(
  client: JmapClient,
  options: { mailboxId?: string; text?: string; hasAttachment?: boolean; position?: number; limit?: number; signal?: AbortSignal },
): Promise<EmailPage> {
  const filter: Record<string, unknown> = {};
  if (options.mailboxId) filter.inMailbox = options.mailboxId;
  if (options.text) filter.text = options.text;
  if (options.hasAttachment) filter.hasAttachment = true;
  const response = await client.request([CAPABILITIES.mail], [
    ["Email/query", {
      accountId: client.mailAccountId,
      filter,
      sort: [{ property: "receivedAt", isAscending: false }],
      collapseThreads: true,
      calculateTotal: true,
      position: options.position ?? 0,
      limit: options.limit ?? 50,
    }, "query"],
    ["Email/get", {
      accountId: client.mailAccountId,
      "#ids": { resultOf: "query", name: "Email/query", path: "/ids" },
      properties: ["id", "blobId", "threadId", "mailboxIds", "keywords", "receivedAt", "sentAt", "from", "to", "cc", "subject", "preview", "hasAttachment", "attachments"],
    }, "get"],
  ], options.signal);
  const query = findResponse<QueryResult>(response.methodResponses, "query");
  const get = findResponse<GetResult<Email>>(response.methodResponses, "get");
  return { emails: get.list, total: query.total ?? get.list.length, queryState: query.queryState };
}

export async function getEmail(client: JmapClient, id: string): Promise<Email> {
  const result = await client.call<GetResult<Email>>(CAPABILITIES.mail, "Email/get", {
    accountId: client.mailAccountId,
    ids: [id],
    properties: ["id", "blobId", "threadId", "mailboxIds", "keywords", "receivedAt", "sentAt", "from", "to", "cc", "subject", "preview", "hasAttachment", "textBody", "htmlBody", "attachments", "bodyValues"],
    fetchTextBodyValues: true,
    fetchHTMLBodyValues: true,
    maxBodyValueBytes: 2_000_000,
  });
  if (!result.list[0]) throw new JmapError("This message no longer exists.", "notFound");
  return result.list[0];
}

export function isCalendarInvitationPart(part: EmailBodyPart): boolean {
  const type = (part.type ?? "").toLowerCase();
  if (type.startsWith("text/calendar") || type === "application/ics" || type === "application/calendar") return true;
  const name = (part.name ?? "").toLowerCase();
  return name.endsWith(".ics") || name.endsWith(".ifb");
}

export function findCalendarInvitationPart(email: Pick<Email, "attachments" | "textBody" | "htmlBody">): EmailBodyPart | undefined {
  return [...(email.attachments ?? []), ...(email.textBody ?? []), ...(email.htmlBody ?? [])].find(isCalendarInvitationPart);
}

export async function patchEmail(client: JmapClient, id: string, patch: Record<string, unknown>): Promise<void> {
  await patchEmails(client, [id], patch);
}

export async function patchEmails(client: JmapClient, ids: string[], patch: Record<string, unknown>): Promise<void> {
  if (!ids.length) return;
  const result = await client.call<SetResult>(CAPABILITIES.mail, "Email/set", {
    accountId: client.mailAccountId,
    update: Object.fromEntries(ids.map((id) => [id, patch])),
  });
  const failed = ids.find((id) => result.notUpdated?.[id]);
  if (failed) throw new JmapError(String(result.notUpdated?.[failed]?.description ?? "The messages could not be updated."), String(result.notUpdated?.[failed]?.type ?? "notUpdated"));
}

export async function destroyEmail(client: JmapClient, id: string): Promise<void> {
  await client.call(CAPABILITIES.mail, "Email/set", { accountId: client.mailAccountId, destroy: [id] });
}

export async function getIdentities(client: JmapClient): Promise<Identity[]> {
  const result = await client.call<GetResult<Identity>>(CAPABILITIES.submission, "Identity/get", {
    accountId: client.mailAccountId,
    properties: ["id", "name", "email", "mayDelete", "textSignature", "htmlSignature"],
  });
  return result.list;
}

export const SIGNATURE_MAX_LENGTH = 2047;

export function identitySignatureText(identity?: Identity): string {
  if (identity?.textSignature?.trim()) return identity.textSignature.replace(/\s+$/, "");
  return htmlToTextSignature(identity?.htmlSignature ?? "").replace(/\s+$/, "");
}

export function signatureBlock(signature: string): string {
  const text = signature.replace(/\s+$/, "");
  if (!text.trim()) return "";
  return /^(?:-- |--$)/.test(text) ? text : `-- \n${text}`;
}

export function composeDraftBody(options: { signature?: string; quoted?: string; forwarded?: string } = {}): string {
  const blocks = [""];
  const signature = signatureBlock(options.signature ?? "");
  if (signature) blocks.push(signature);
  if (options.quoted) blocks.push(options.quoted);
  if (options.forwarded) blocks.push(options.forwarded);
  return blocks.join("\n\n");
}

export function replyQuote(email: Email): string {
  const who = email.from?.[0]?.name || email.from?.[0]?.email || "someone";
  const quoted = (emailPlainText(email) || email.preview || "").replace(/\r\n/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");
  return `On ${new Date(email.receivedAt).toLocaleString()}, ${who} wrote:\n${quoted}`;
}

export function replySubject(subject?: string): string {
  return /^re:/i.test(subject ?? "") ? subject ?? "" : `Re: ${subject ?? ""}`;
}

export function forwardSubject(subject?: string): string {
  return /^fwd:/i.test(subject ?? "") ? subject ?? "" : `Fwd: ${subject ?? ""}`;
}

export function forwardedMessage(email: Email): string {
  const recipients = (email.to ?? []).map(formatMailbox).filter(Boolean).join(", ") || "undisclosed-recipients";
  return [
    "---------- Forwarded message ---------",
    `From: ${formatMailbox(email.from?.[0])}`,
    `Date: ${new Date(email.receivedAt).toLocaleString()}`,
    `Subject: ${email.subject || "(no subject)"}`,
    `To: ${recipients}`,
    "",
    emailPlainText(email) || email.preview || "",
  ].join("\n");
}

export function emailPlainText(email: Email): string {
  const part = email.textBody?.find((item) => item.partId && email.bodyValues?.[item.partId]);
  return part?.partId ? email.bodyValues?.[part.partId]?.value ?? "" : "";
}

function formatMailbox(address?: { name?: string; email?: string }): string {
  return address?.name ? `${address.name} <${address.email}>` : address?.email || "Unknown sender";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function htmlToTextSignature(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function textToHtmlSignature(text: string): string {
  const html = text.split("\n").map(escapeHtml).join("<br>");
  return html.length < 2048 ? html : escapeHtml(text.replace(/\s+/g, " ")).slice(0, SIGNATURE_MAX_LENGTH);
}

export async function updateIdentitySignatures(client: JmapClient, identityId: string, textSignature: string): Promise<void> {
  if (textSignature.length > SIGNATURE_MAX_LENGTH) {
    throw new JmapError(`Keep the signature under ${SIGNATURE_MAX_LENGTH} characters.`, "invalidProperties");
  }
  const result = await client.call<SetResult>(CAPABILITIES.submission, "Identity/set", {
    accountId: client.mailAccountId,
    update: { [identityId]: { textSignature, htmlSignature: textToHtmlSignature(textSignature) } },
  });
  if (result.notUpdated?.[identityId]) {
    throw new JmapError(String(result.notUpdated[identityId].description ?? "The signature could not be saved."), String(result.notUpdated[identityId].type ?? "notUpdated"));
  }
}

function cleanHeader(value: string): string { return value.replace(/[\r\n]+/g, " ").trim(); }

function parseAddresses(value: string): string[] {
  return value.split(",").map(cleanHeader).filter(Boolean);
}

export async function buildMimeMessage(input: DraftInput, identity: Identity, attachments: File[] = []): Promise<Blob> {
  const headers = [
    `From: ${cleanHeader(identity.name)} <${cleanHeader(identity.email)}>`,
    `To: ${parseAddresses(input.to).join(", ")}`,
  ];
  if (input.cc) headers.push(`Cc: ${parseAddresses(input.cc).join(", ")}`);
  if (input.bcc) headers.push(`Bcc: ${parseAddresses(input.bcc).join(", ")}`);
  headers.push(`Subject: ${cleanHeader(input.subject)}`, "MIME-Version: 1.0");
  if (!attachments.length) {
    headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", input.body.replace(/\r?\n/g, "\r\n"));
  } else {
    const boundary = `stalwart-${crypto.randomUUID()}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", input.body.replace(/\r?\n/g, "\r\n"));
    for (const file of attachments) {
      headers.push(
        `--${boundary}`,
        `Content-Type: ${cleanHeader(file.type || "application/octet-stream")}; name="${quoteParameter(file.name)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${quoteParameter(file.name)}"`,
        "",
        toBase64(await file.arrayBuffer()),
      );
    }
    headers.push(`--${boundary}--`, "");
  }
  return new Blob([headers.join("\r\n")], { type: "message/rfc822" });
}

export async function saveDraft(
  client: JmapClient,
  input: DraftInput,
  identity: Identity,
  draftMailboxId: string,
  previousDraftId?: string,
  attachments: File[] = [],
): Promise<string> {
  const upload = await client.upload(client.mailAccountId, await buildMimeMessage(input, identity, attachments));
  const result = await client.call<Record<string, any>>(CAPABILITIES.mail, "Email/import", {
    accountId: client.mailAccountId,
    emails: {
      draft: { blobId: upload.blobId, mailboxIds: { [draftMailboxId]: true }, keywords: { "$draft": true, "$seen": true } },
    },
  });
  const id = result.created?.draft?.id as string | undefined;
  if (!id) throw new JmapError("The draft could not be saved.", "draftNotCreated", result.notCreated?.draft);
  if (previousDraftId && previousDraftId !== id) await destroyEmail(client, previousDraftId).catch(() => undefined);
  return id;
}

function quoteParameter(value: string): string { return cleanHeader(value).replace(/["\\]/g, "_"); }

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export async function sendDraft(
  client: JmapClient,
  emailId: string,
  identityId: string,
  draftMailboxId: string,
  sentMailboxId: string,
): Promise<void> {
  const result = await client.call<Record<string, any>>([CAPABILITIES.mail, CAPABILITIES.submission], "EmailSubmission/set", {
    accountId: client.mailAccountId,
    create: { send: { emailId, identityId } },
    onSuccessUpdateEmail: {
      "#send": {
        [`mailboxIds/${sentMailboxId}`]: true,
        [`mailboxIds/${draftMailboxId}`]: null,
        "keywords/$draft": null,
        "keywords/$seen": true,
      },
    },
  });
  if (!result.created?.send) throw new JmapError(String(result.notCreated?.send?.description ?? "The message was not sent."), String(result.notCreated?.send?.type ?? "submissionFailed"));
}
