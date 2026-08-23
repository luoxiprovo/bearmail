import { describe, expect, it, vi } from "vitest";
import { JmapError } from "./client";
import { ACCOUNT_PASSWORD_ID, changeAccountPassword, validateNewPassword } from "./account";
import type { JmapClient } from "./client";

describe("account password", () => {
  it("rejects empty, mismatched, reused, and short passwords", () => {
    expect(() => validateNewPassword("", "abcdefgh", "abcdefgh")).toThrow(JmapError);
    expect(() => validateNewPassword("old-secret", "abcdefgh", "other")).toThrow(/do not match/);
    expect(() => validateNewPassword("same-pass", "same-pass", "same-pass")).toThrow(/different from the current/);
    expect(() => validateNewPassword("old-secret", "short", "short")).toThrow(/at least 8/);
  });

  it("updates the account password through the Stalwart registry", async () => {
    const call = vi.fn().mockResolvedValue({ updated: { [ACCOUNT_PASSWORD_ID]: null } });
    const client = { mailAccountId: "account", call } as unknown as JmapClient;
    await changeAccountPassword(client, "old-secret-1", "new-secret-1");
    expect(call).toHaveBeenCalledWith("urn:stalwart:jmap", "x:AccountPassword/set", {
      accountId: "account",
      update: {
        singleton: { currentSecret: "old-secret-1", secret: "new-secret-1" },
      },
    });
  });

  it("surfaces the server description when the current secret is wrong", async () => {
    const call = vi.fn().mockResolvedValue({
      notUpdated: { singleton: { type: "forbidden", description: "Current secret is incorrect." } },
    });
    const client = { mailAccountId: "account", call } as unknown as JmapClient;
    await expect(changeAccountPassword(client, "wrong-secret", "new-secret-1")).rejects.toMatchObject({
      message: "Current secret is incorrect.",
      type: "forbidden",
    });
  });
});
