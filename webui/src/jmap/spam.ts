import { CAPABILITIES, type Email, type Mailbox } from "../types";
import { JmapClient, JmapError } from "./client";
import { patchEmail } from "./mail";

export const BLOCKED_SENDERS_SCRIPT = "BearMail blocked senders";

interface SieveScript {
  id: string;
  name?: string;
  blobId?: string;
  isActive?: boolean;
}

interface QueryResult { ids: string[] }
interface GetResult<T> { list: T[] }
interface SetResult {
  created?: Record<string, { id?: string }>;
  updated?: Record<string, null>;
  notCreated?: Record<string, Record<string, unknown>>;
  notUpdated?: Record<string, Record<string, unknown>>;
}

export function senderAddress(email: Pick<Email, "from">): string {
  return (email.from?.[0]?.email ?? "").trim().toLowerCase();
}

export function junkMailboxPatch(email: Pick<Email, "mailboxIds">, junkMailboxId: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [`mailboxIds/${junkMailboxId}`]: true,
    "keywords/$junk": true,
    "keywords/$notjunk": null,
  };
  for (const id of Object.keys(email.mailboxIds ?? {})) {
    if (id !== junkMailboxId) patch[`mailboxIds/${id}`] = null;
  }
  return patch;
}

export function notSpamMailboxPatch(email: Pick<Email, "mailboxIds">, inboxMailboxId: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [`mailboxIds/${inboxMailboxId}`]: true,
    "keywords/$junk": null,
    "keywords/$notjunk": true,
  };
  for (const id of Object.keys(email.mailboxIds ?? {})) {
    if (id !== inboxMailboxId) patch[`mailboxIds/${id}`] = null;
  }
  return patch;
}

export function emailIsInMailbox(email: Pick<Email, "mailboxIds">, mailboxId?: string): boolean {
  return Boolean(mailboxId && email.mailboxIds?.[mailboxId]);
}

export async function markEmailAsSpam(client: JmapClient, email: Pick<Email, "id" | "mailboxIds">, junkMailboxId: string): Promise<void> {
  await patchEmail(client, email.id, junkMailboxPatch(email, junkMailboxId));
}

export async function markEmailAsNotSpam(client: JmapClient, email: Pick<Email, "id" | "mailboxIds">, inboxMailboxId: string): Promise<void> {
  await patchEmail(client, email.id, notSpamMailboxPatch(email, inboxMailboxId));
}

const EMAIL_RE = /^[^\s,<>"]+@[^\s,<>"]+\.[^\s,<>"]+$/;

export function blockedAddressesFromScript(source: string): string[] {
  const header = source.match(/^# bearmail-blocked:\s*([^\r\n]*)/m);
  const fromHeader = header?.[1]?.split(",").map((item) => item.trim().toLowerCase()).filter((item) => EMAIL_RE.test(item)) ?? [];
  const fromList = [...source.matchAll(/"([^\s"]+@[^\s"]+)"/g)].map((match) => match[1].toLowerCase()).filter((item) => EMAIL_RE.test(item));
  return [...new Set([...fromHeader, ...fromList])];
}

function uniqueAddresses(addresses: string[]): string[] {
  return [...new Set(addresses.map((item) => item.trim().toLowerCase()).filter((item) => item.includes("@")))].sort();
}

function quoteSieveAddresses(addresses: string[]): string {
  return addresses.map((item) => `"${item.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(", ");
}

export function blockedSendersScript(addresses: string[]): string {
  const unique = uniqueAddresses(addresses);
  if (!unique.length) {
    return "# bearmail-blocked:\r\nkeep;\r\n";
  }
  return [
    `# bearmail-blocked: ${unique.join(",")}`,
    'require ["fileinto"];',
    `if address :is "from" [${quoteSieveAddresses(unique)}] {`,
    '  fileinto "Junk";',
    "}",
    "",
  ].join("\r\n");
}

export function mergeBlockedSenders(source: string, addresses: string[]): string {
  const unique = uniqueAddresses([...blockedAddressesFromScript(source), ...addresses]);
  if (!source.trim() || /^\s*# bearmail-blocked:[\s\S]*$/.test(source) || /^\s*keep;\s*$/.test(source)) {
    return blockedSendersScript(unique);
  }
  let next = source.replace(/\r?\n?# BEGIN bearmail-blocked[\s\S]*?# END bearmail-blocked\s*/g, "\n");
  if (!unique.length) return next.trim() ? next.replace(/\n{3,}/g, "\n\n") : "keep;\r\n";
  if (!/\bfileinto\b/.test(next)) {
    if (/^require\s*\[/m.test(next)) {
      next = next.replace(/require\s*\[([^\]]*)\]/, (_match, inner: string) => (
        inner.includes("fileinto") ? `require [${inner}]` : `require [${inner.replace(/\s+$/, "")}${inner.trim() ? ", " : ""}"fileinto"]`
      ));
    } else {
      next = `require ["fileinto"];\r\n${next}`;
    }
  }
  const snippet = [
    "# BEGIN bearmail-blocked",
    `# bearmail-blocked: ${unique.join(",")}`,
    `if address :is "from" [${quoteSieveAddresses(unique)}] {`,
    '  fileinto "Junk";',
    "}",
    "# END bearmail-blocked",
    "",
  ].join("\r\n");
  const requires = next.match(/^(?:[ \t]*require\s*\[[^\]]*\]\s*;\s*(?:\r?\n)?)+/);
  if (requires) {
    const insertAt = requires[0].length;
    return `${next.slice(0, insertAt)}${snippet}${next.slice(insertAt).replace(/^\s+/, "")}`;
  }
  return `${snippet}${next.replace(/^\s+/, "")}`;
}

async function listSieveScripts(client: JmapClient): Promise<SieveScript[]> {
  const query = await client.call<QueryResult>(CAPABILITIES.sieve, "SieveScript/query", {
    accountId: client.mailAccountId,
  });
  if (!query.ids?.length) return [];
  const result = await client.call<GetResult<SieveScript>>(CAPABILITIES.sieve, "SieveScript/get", {
    accountId: client.mailAccountId,
    ids: query.ids,
    properties: ["id", "name", "blobId", "isActive"],
  });
  return result.list ?? [];
}

async function downloadTextBlob(client: JmapClient, blobId: string): Promise<string> {
  const response = await fetch(client.downloadUrl(client.mailAccountId, blobId, "script.sieve", "application/sieve"), {
    headers: { Authorization: client.authorizationHeader() },
  });
  if (!response.ok) throw new JmapError(`The block list could not be read (${response.status}).`, "blobNotFound");
  return response.text();
}

export async function blockSender(client: JmapClient, address: string): Promise<void> {
  const sender = address.trim().toLowerCase();
  if (!sender.includes("@")) throw new JmapError("This message has no sender address to block.", "invalidProperties");
  if (!client.has(CAPABILITIES.sieve)) {
    throw new JmapError("This server does not advertise Sieve filters, so the sender cannot be blocked automatically.", "missingCapability");
  }
  const scripts = await listSieveScripts(client);
  const existing = scripts.find((script) => script.name === BLOCKED_SENDERS_SCRIPT);
  const active = scripts.find((script) => script.isActive);
  const target = active ?? existing;
  let source = "";
  if (target?.blobId) {
    try { source = await downloadTextBlob(client, target.blobId); } catch { source = ""; }
  }
  if (target && target !== existing && !source.trim()) {
    throw new JmapError("The active filter could not be read, so the sender was not blocked.", "blobNotFound");
  }
  const script = target && target !== existing
    ? mergeBlockedSenders(source, [sender])
    : blockedSendersScript([...blockedAddressesFromScript(source), sender]);
  const upload = await client.upload(client.mailAccountId, new Blob([script], { type: "application/sieve" }));
  const result = target
    ? await client.call<SetResult>(CAPABILITIES.sieve, "SieveScript/set", {
        accountId: client.mailAccountId,
        update: { [target.id]: { blobId: upload.blobId } },
        ...(!active || active.id === target.id ? { onSuccessActivateScript: target.id } : {}),
      })
    : await client.call<SetResult>(CAPABILITIES.sieve, "SieveScript/set", {
        accountId: client.mailAccountId,
        create: { blocked: { name: BLOCKED_SENDERS_SCRIPT, blobId: upload.blobId } },
        onSuccessActivateScript: "#blocked",
      });
  const failed = target
    ? result.notUpdated?.[target.id]
    : result.notCreated?.blocked;
  if (failed) throw new JmapError(String(failed.description ?? "The sender could not be blocked."), String(failed.type ?? "notUpdated"));
  if (!target && !result.created?.blocked) {
    throw new JmapError("The sender could not be blocked.", "notCreated");
  }
}

export async function markAsSpamAndBlockSender(
  client: JmapClient,
  email: Pick<Email, "id" | "mailboxIds" | "from">,
  junkMailbox: Pick<Mailbox, "id">,
): Promise<{ blocked: boolean; sender: string }> {
  const sender = senderAddress(email);
  await markEmailAsSpam(client, email, junkMailbox.id);
  if (!sender) return { blocked: false, sender: "" };
  await blockSender(client, sender);
  return { blocked: true, sender };
}
