import { describe, expect, it, vi } from "vitest";
import { CAPABILITIES } from "../types";
import type { JmapClient } from "./client";
import { BLOCKED_SENDERS_SCRIPT, blockedAddressesFromScript, blockedSendersScript, blockSender, junkMailboxPatch, markAsSpamAndBlockSender, markEmailAsNotSpam, mergeBlockedSenders, notSpamMailboxPatch, senderAddress } from "./spam";

describe("spam and block", () => {
  it("extracts the sender and builds a junk mailbox patch", () => {
    expect(senderAddress({ from: [{ email: "Bob@Example.TEST" }] })).toBe("bob@example.test");
    expect(junkMailboxPatch({ mailboxIds: { inbox: true, other: true } }, "junk")).toEqual({
      "mailboxIds/junk": true,
      "keywords/$junk": true,
      "keywords/$notjunk": null,
      "mailboxIds/inbox": null,
      "mailboxIds/other": null,
    });
    expect(notSpamMailboxPatch({ mailboxIds: { junk: true } }, "inbox")).toEqual({
      "mailboxIds/inbox": true,
      "keywords/$junk": null,
      "keywords/$notjunk": true,
      "mailboxIds/junk": null,
    });
  });

  it("round-trips blocked addresses in the Sieve script", () => {
    const source = blockedSendersScript(["cara@example.test", "bob@example.test", "bob@example.test"]);
    expect(source).toContain("# bearmail-blocked: bob@example.test,cara@example.test");
    expect(source).toContain('fileinto "Junk"');
    expect(blockedAddressesFromScript(source)).toEqual(["bob@example.test", "cara@example.test"]);
  });

  it("merges blocked senders into an existing Sieve script without replacing it", () => {
    const merged = mergeBlockedSenders('require ["vacation"];\r\nvacation "Out of office";\r\n', ["spam@example.test"]);
    expect(merged).toContain("vacation");
    expect(merged).toContain("# BEGIN bearmail-blocked");
    expect(merged).toMatch(/require \["vacation", "fileinto"\]/);
    expect(blockedAddressesFromScript(merged)).toEqual(["spam@example.test"]);
  });

  it("creates and activates a blocked-senders Sieve script", async () => {
    const upload = vi.fn().mockResolvedValue({ blobId: "blob-1" });
    const call = vi.fn()
      .mockResolvedValueOnce({ ids: [] })
      .mockResolvedValueOnce({ created: { blocked: { id: "sieve-1" } } });
    const client = {
      mailAccountId: "account",
      has: (id: string) => id === CAPABILITIES.sieve,
      upload,
      call,
    } as unknown as JmapClient;
    await blockSender(client, "spam@example.test");
    expect(upload).toHaveBeenCalled();
    expect(call).toHaveBeenLastCalledWith("urn:ietf:params:jmap:sieve", "SieveScript/set", expect.objectContaining({
      create: { blocked: { name: BLOCKED_SENDERS_SCRIPT, blobId: "blob-1" } },
      onSuccessActivateScript: "#blocked",
    }));
  });

  it("marks the message as spam then blocks the sender", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ updated: { "mail-1": null } })
      .mockResolvedValueOnce({ ids: [] })
      .mockResolvedValueOnce({ created: { blocked: { id: "sieve-1" } } });
    const client = {
      mailAccountId: "account",
      has: () => true,
      upload: vi.fn().mockResolvedValue({ blobId: "blob-1" }),
      call,
    } as unknown as JmapClient;
    const result = await markAsSpamAndBlockSender(client, {
      id: "mail-1",
      mailboxIds: { inbox: true },
      from: [{ email: "spam@example.test" }],
    }, { id: "junk" });
    expect(result).toEqual({ blocked: true, sender: "spam@example.test" });
    expect(call.mock.calls[0][1]).toBe("Email/set");
  });

  it("moves a junk message back to inbox as not spam", async () => {
    const call = vi.fn().mockResolvedValue({ updated: { "mail-1": null } });
    const client = {
      mailAccountId: "account",
      call,
    } as unknown as JmapClient;
    await markEmailAsNotSpam(client, { id: "mail-1", mailboxIds: { junk: true } }, "inbox");
    expect(call).toHaveBeenCalledWith("urn:ietf:params:jmap:mail", "Email/set", expect.objectContaining({
      update: {
        "mail-1": {
          "mailboxIds/inbox": true,
          "keywords/$junk": null,
          "keywords/$notjunk": true,
          "mailboxIds/junk": null,
        },
      },
    }));
  });
});
