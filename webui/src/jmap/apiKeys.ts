import { CAPABILITIES } from "../types";
import { JmapClient, JmapError } from "./client";

export interface AccountApiKey {
  id: string;
  description: string;
  createdAt?: string;
  expiresAt?: string | null;
}

export interface CreatedApiKey {
  id: string;
  secret: string;
}

interface QueryResult {
  ids?: unknown[];
}

interface GetResult {
  list?: Array<Record<string, unknown>>;
}

interface SetError {
  type?: string;
  description?: string;
}

interface SetResult {
  created?: Record<string, { id?: unknown; secret?: unknown }>;
  destroyed?: unknown[];
  notCreated?: Record<string, SetError>;
  notDestroyed?: Record<string, SetError>;
}

const CREATE_ID = "new-key";
const MASKED_SECRET = "****";
const NAME_MAX_LENGTH = 200;

function idOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "";
}

function failure(entry: SetError | undefined, fallback: string, type: string): JmapError | null {
  if (!entry) return null;
  return new JmapError(entry.description || fallback, entry.type || type);
}

export function validateApiKeyName(description: string): string {
  const name = description.trim();
  if (!name) throw new JmapError("Enter a name for this API key.", "invalidProperties");
  if (name.length > NAME_MAX_LENGTH) {
    throw new JmapError(`Use a name of ${NAME_MAX_LENGTH} characters or fewer.`, "invalidProperties");
  }
  return name;
}

export async function listAccountApiKeys(client: JmapClient): Promise<AccountApiKey[]> {
  const query = await client.call<QueryResult>(CAPABILITIES.stalwart, "x:ApiKey/query", {
    accountId: client.mailAccountId,
    sort: [{ property: "id", isAscending: false }],
  });
  const ids = (query.ids ?? []).map(idOf).filter(Boolean);
  if (ids.length === 0) return [];
  const got = await client.call<GetResult>(CAPABILITIES.stalwart, "x:ApiKey/get", {
    accountId: client.mailAccountId,
    ids,
    properties: ["id", "description", "createdAt", "expiresAt"],
  });
  const byId = new Map<string, AccountApiKey>();
  for (const item of got.list ?? []) {
    const id = idOf(item.id);
    if (!id) continue;
    const description = typeof item.description === "string" ? item.description.trim() : "";
    byId.set(id, {
      id,
      description: description || "API key",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
      expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : null,
    });
  }
  return ids.flatMap((id) => {
    const key = byId.get(id);
    return key ? [key] : [];
  });
}

export async function createAccountApiKey(client: JmapClient, description: string): Promise<CreatedApiKey> {
  const name = validateApiKeyName(description);
  const result = await client.call<SetResult>(CAPABILITIES.stalwart, "x:ApiKey/set", {
    accountId: client.mailAccountId,
    create: { [CREATE_ID]: { description: name } },
  });
  const rejected = failure(result.notCreated?.[CREATE_ID], "The API key could not be created.", "notCreated");
  if (rejected) throw rejected;
  const created = result.created?.[CREATE_ID];
  const id = idOf(created?.id);
  const secret = typeof created?.secret === "string" ? created.secret : "";
  if (!id || !secret || secret === MASKED_SECRET) {
    throw new JmapError("The server did not return the new API key.", "notCreated");
  }
  return { id, secret };
}

export async function revokeAccountApiKey(client: JmapClient, id: string): Promise<void> {
  const result = await client.call<SetResult>(CAPABILITIES.stalwart, "x:ApiKey/set", {
    accountId: client.mailAccountId,
    destroy: [id],
  });
  const rejected = failure(result.notDestroyed?.[id], "The API key could not be revoked.", "notDestroyed");
  if (rejected) throw rejected;
  if (!(result.destroyed ?? []).some((value) => idOf(value) === id)) {
    throw new JmapError("The server did not confirm that the API key was revoked.", "notDestroyed");
  }
}
