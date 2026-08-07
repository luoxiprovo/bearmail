import { CAPABILITIES, type DraftInput, type Email, type Identity, type Mailbox } from "../types";
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
  options: { mailboxId?: string; text?: string; position?: number; limit?: number; signal?: AbortSignal },
): Promise<EmailPage> {
  const filter: Record<string, unknown> = {};
  if (options.mailboxId) filter.inMailbox = options.mailboxId;
  if (options.text) filter.text = options.text;
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

export async function patchEmail(client: JmapClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const result = await client.call<SetResult>(CAPABILITIES.mail, "Email/set", {
    accountId: client.mailAccountId,
    update: { [id]: patch },
  });
  if (result.notUpdated?.[id]) throw new JmapError(String(result.notUpdated[id].description ?? "The message could not be updated."), String(result.notUpdated[id].type ?? "notUpdated"));
}

export async function destroyEmail(client: JmapClient, id: string): Promise<void> {
  await client.call(CAPABILITIES.mail, "Email/set", { accountId: client.mailAccountId, destroy: [id] });
}

export async function getIdentities(client: JmapClient): Promise<Identity[]> {
  const result = await client.call<GetResult<Identity>>(CAPABILITIES.submission, "Identity/get", {
    accountId: client.mailAccountId,
    properties: ["id", "name", "email", "mayDelete"],
  });
  return result.list;
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

export async function sendDraft(client: JmapClient, emailId: string, identityId: string): Promise<void> {
  const result = await client.call<Record<string, any>>([CAPABILITIES.mail, CAPABILITIES.submission], "EmailSubmission/set", {
    accountId: client.mailAccountId,
    create: { send: { emailId, identityId } },
    onSuccessDestroyEmail: ["#send"],
  });
  if (!result.created?.send) throw new JmapError(String(result.notCreated?.send?.description ?? "The message was not sent."), String(result.notCreated?.send?.type ?? "submissionFailed"));
}
