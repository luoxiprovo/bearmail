import { describe, expect, it, vi } from "vitest";
import { JmapError } from "./client";
import type { JmapClient } from "./client";
import { createAccountApiKey, listAccountApiKeys, revokeAccountApiKey, validateApiKeyName } from "./apiKeys";

describe("account API keys", () => {
  it("requires a short name", () => {
    expect(() => validateApiKeyName("  ")).toThrow(/Enter a name/);
    expect(() => validateApiKeyName("x".repeat(201))).toThrow(/200 characters/);
    expect(validateApiKeyName("  Agent  ")).toBe("Agent");
  });

  it("lists keys without asking for the stored secret", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ids: ["b", "a"] })
      .mockResolvedValueOnce({
        list: [
          { id: "a", description: "  ", createdAt: "2026-01-01T00:00:00Z", secret: "****" },
          { id: "b", description: "Laptop", createdAt: "2026-02-01T00:00:00Z", expiresAt: "2026-03-01T00:00:00Z" },
        ],
      });
    const client = { mailAccountId: "account", call } as unknown as JmapClient;
    await expect(listAccountApiKeys(client)).resolves.toEqual([
      { id: "b", description: "Laptop", createdAt: "2026-02-01T00:00:00Z", expiresAt: "2026-03-01T00:00:00Z" },
      { id: "a", description: "API key", createdAt: "2026-01-01T00:00:00Z", expiresAt: null },
    ]);
    expect(call).toHaveBeenNthCalledWith(1, "urn:stalwart:jmap", "x:ApiKey/query", {
      accountId: "account",
      sort: [{ property: "id", isAscending: false }],
    });
    expect(call).toHaveBeenNthCalledWith(2, "urn:stalwart:jmap", "x:ApiKey/get", {
      accountId: "account",
      ids: ["b", "a"],
      properties: ["id", "description", "createdAt", "expiresAt"],
    });
  });

  it("creates a key and returns the one-time secret", async () => {
    const call = vi.fn().mockResolvedValue({ created: { "new-key": { id: "c", secret: "API_secret" } } });
    const client = { mailAccountId: "account", call } as unknown as JmapClient;
    await expect(createAccountApiKey(client, "Agent")).resolves.toEqual({ id: "c", secret: "API_secret" });
    expect(call).toHaveBeenCalledWith("urn:stalwart:jmap", "x:ApiKey/set", {
      accountId: "account",
      create: { "new-key": { description: "Agent" } },
    });
  });

  it("surfaces a quota error and rejects a masked secret", async () => {
    const client = {
      mailAccountId: "account",
      call: vi.fn().mockResolvedValue({
        notCreated: { "new-key": { type: "overQuota", description: "You have exceeded your quota of 1 API keys." } },
      }),
    } as unknown as JmapClient;
    await expect(createAccountApiKey(client, "Agent")).rejects.toMatchObject({
      message: "You have exceeded your quota of 1 API keys.",
      type: "overQuota",
    });

    const masked = { mailAccountId: "account", call: vi.fn().mockResolvedValue({ created: { "new-key": { id: "c", secret: "****" } } }) } as unknown as JmapClient;
    await expect(createAccountApiKey(masked, "Agent")).rejects.toBeInstanceOf(JmapError);
  });

  it("revokes a key only after the server confirms it", async () => {
    const call = vi.fn().mockResolvedValue({ destroyed: ["b"] });
    const client = { mailAccountId: "account", call } as unknown as JmapClient;
    await revokeAccountApiKey(client, "b");
    expect(call).toHaveBeenCalledWith("urn:stalwart:jmap", "x:ApiKey/set", {
      accountId: "account",
      destroy: ["b"],
    });

    const missing = { mailAccountId: "account", call: vi.fn().mockResolvedValue({ destroyed: [] }) } as unknown as JmapClient;
    await expect(revokeAccountApiKey(missing, "b")).rejects.toThrow(/did not confirm/);
  });
});
