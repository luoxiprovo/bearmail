import { bytesToBase64, extractInlineImages, htmlToPlainText, looksLikeHtml, plainTextToHtml, sanitizeComposeHtml } from "../richtext";
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
export const HTML_SIGNATURE_MAX_LENGTH = 32_000;

export function identitySignatureText(identity?: Identity): string {
  if (identity?.textSignature?.trim()) return identity.textSignature.replace(/\s+$/, "");
  return htmlToPlainText(identity?.htmlSignature ?? "").replace(/\s+$/, "");
}

export function identitySignatureHtml(identity?: Identity): string {
  if (identity?.htmlSignature?.trim()) return sanitizeComposeHtml(identity.htmlSignature);
  const text = identity?.textSignature?.trim() ?? "";
  return text ? textToHtmlSignature(text) : "";
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

export function composeDraftHtml(options: { signatureHtml?: string; quotedHtml?: string; forwardedHtml?: string } = {}): string {
  const blocks = ["<p><br></p>"];
  if (options.signatureHtml?.trim()) {
    const html = sanitizeComposeHtml(options.signatureHtml);
    blocks.push(`<div class="signature">${html}</div>`);
  }
  if (options.quotedHtml?.trim()) blocks.push(options.quotedHtml);
  if (options.forwardedHtml?.trim()) blocks.push(options.forwardedHtml);
  return blocks.join("");
}

export function emailHtml(email: Email): string {
  const part = email.htmlBody?.find((item) => item.partId && email.bodyValues?.[item.partId]);
  return part?.partId ? email.bodyValues?.[part.partId]?.value ?? "" : "";
}

export function draftBodyFromEmail(email: Email): { body: string; htmlBody: string } {
  const html = emailHtml(email);
  const text = emailPlainText(email) || email.preview || "";
  if (html.trim()) return { body: htmlToPlainText(html) || text, htmlBody: sanitizeComposeHtml(html) };
  return { body: text, htmlBody: plainTextToHtml(text) };
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

export function replyQuoteHtml(email: Email): string {
  const who = email.from?.[0]?.name || email.from?.[0]?.email || "someone";
  const inner = emailHtml(email).trim() || plainTextToHtml(emailPlainText(email) || email.preview || "");
  return `<p>On ${escapeAttr(new Date(email.receivedAt).toLocaleString())}, ${escapeAttr(who)} wrote:</p><blockquote>${sanitizeComposeHtml(inner)}</blockquote>`;
}

export function forwardedMessageHtml(email: Email): string {
  const recipients = (email.to ?? []).map(formatMailbox).filter(Boolean).join(", ") || "undisclosed-recipients";
  const inner = emailHtml(email).trim() || plainTextToHtml(emailPlainText(email) || email.preview || "");
  return `<p><strong>---------- Forwarded message ---------</strong><br>From: ${escapeAttr(formatMailbox(email.from?.[0]))}<br>Date: ${escapeAttr(new Date(email.receivedAt).toLocaleString())}<br>Subject: ${escapeAttr(email.subject || "(no subject)")}<br>To: ${escapeAttr(recipients)}</p>${sanitizeComposeHtml(inner)}`;
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export function emailPlainText(email: Email): string {
  const part = email.textBody?.find((item) => item.partId && email.bodyValues?.[item.partId]);
  return part?.partId ? email.bodyValues?.[part.partId]?.value ?? "" : "";
}

function formatMailbox(address?: { name?: string; email?: string }): string {
  return address?.name ? `${address.name} <${address.email}>` : address?.email || "Unknown sender";
}

export function textToHtmlSignature(text: string): string {
  const html = text.split("\n").map((line) => line.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char))).join("<br>");
  return html.length < 2048 ? html : html.slice(0, SIGNATURE_MAX_LENGTH);
}

export async function updateIdentitySignatures(client: JmapClient, identityId: string, textSignature: string, htmlSignature?: string): Promise<void> {
  const html = htmlSignature?.trim() ? sanitizeComposeHtml(htmlSignature) : textToHtmlSignature(textSignature);
  if (textSignature.length > SIGNATURE_MAX_LENGTH) {
    throw new JmapError(`Keep the signature under ${SIGNATURE_MAX_LENGTH} characters.`, "invalidProperties");
  }
  if (html.length > HTML_SIGNATURE_MAX_LENGTH) {
    throw new JmapError("The signature image is too large. Use a smaller picture.", "invalidProperties");
  }
  const result = await client.call<SetResult>(CAPABILITIES.submission, "Identity/set", {
    accountId: client.mailAccountId,
    update: { [identityId]: { textSignature, htmlSignature: html } },
  });
  if (result.notUpdated?.[identityId]) {
    throw new JmapError(String(result.notUpdated[identityId].description ?? "The signature could not be saved."), String(result.notUpdated[identityId].type ?? "notUpdated"));
  }
}

function cleanHeader(value: string): string { return value.replace(/[\r\n]+/g, " ").trim(); }

function parseAddresses(value: string): string[] {
  return value.split(",").map(cleanHeader).filter(Boolean);
}

function mimeHeaders(input: DraftInput, identity: Identity): string[] {
  const headers = [
    `From: ${cleanHeader(identity.name)} <${cleanHeader(identity.email)}>`,
    `To: ${parseAddresses(input.to).join(", ")}`,
  ];
  if (input.cc) headers.push(`Cc: ${parseAddresses(input.cc).join(", ")}`);
  if (input.bcc) headers.push(`Bcc: ${parseAddresses(input.bcc).join(", ")}`);
  headers.push(`Subject: ${cleanHeader(input.subject)}`, "MIME-Version: 1.0");
  return headers;
}

function textPart(body: string): string[] {
  return ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", body.replace(/\r?\n/g, "\r\n")];
}

function htmlPart(html: string): string[] {
  return ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", html.replace(/\r?\n/g, "\r\n")];
}

async function attachmentParts(attachments: File[]): Promise<string[][]> {
  const parts: string[][] = [];
  for (const file of attachments) {
    parts.push([
      `Content-Type: ${cleanHeader(file.type || "application/octet-stream")}; name="${quoteParameter(file.name)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${quoteParameter(file.name)}"`,
      "",
      toBase64(await file.arrayBuffer()),
    ]);
  }
  return parts;
}

function joinMultipart(boundary: string, parts: string[][]): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    lines.push(`--${boundary}`, ...part);
  }
  lines.push(`--${boundary}--`, "");
  return lines;
}

export async function buildMimeMessage(input: DraftInput, identity: Identity, attachments: File[] = []): Promise<Blob> {
  const headers = mimeHeaders(input, identity);
  const htmlSource = input.htmlBody?.trim()
    ? sanitizeComposeHtml(input.htmlBody)
    : looksLikeHtml(input.body) ? sanitizeComposeHtml(input.body) : "";
  if (!htmlSource) {
    if (!attachments.length) {
      headers.push(...textPart(input.body));
    } else {
      const boundary = `stalwart-${crypto.randomUUID()}`;
      headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...joinMultipart(boundary, [textPart(input.body), ...(await attachmentParts(attachments))]));
    }
    return new Blob([headers.join("\r\n")], { type: "message/rfc822" });
  }
  const extracted = extractInlineImages(htmlSource);
  const plain = (input.body.trim() || htmlToPlainText(htmlSource) || "").replace(/\r?\n/g, "\r\n");
  const alternativeBoundary = `alt-${crypto.randomUUID()}`;
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    ...joinMultipart(alternativeBoundary, [textPart(plain), htmlPart(extracted.html)]),
  ];
  const relatedBoundary = `rel-${crypto.randomUUID()}`;
  const relatedParts = [alternative];
  for (const image of extracted.images) {
    relatedParts.push([
      `Content-Type: ${cleanHeader(image.type)}; name="${quoteParameter(image.name)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: inline; filename="${quoteParameter(image.name)}"`,
      `Content-ID: <${image.cid}>`,
      "",
      bytesToBase64(image.bytes),
    ]);
  }
  const related = extracted.images.length
    ? [`Content-Type: multipart/related; boundary="${relatedBoundary}"`, "", ...joinMultipart(relatedBoundary, relatedParts)]
    : alternative;
  if (!attachments.length) {
    headers.push(...related);
  } else {
    const mixedBoundary = `mix-${crypto.randomUUID()}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, "", ...joinMultipart(mixedBoundary, [related, ...(await attachmentParts(attachments))]));
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
