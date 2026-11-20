import { describe, expect, it, vi } from "vitest";
import { buildMimeMessage, composeDraftBody, composeDraftHtml, forwardedMessage, forwardSubject, identitySignatureHtml, identitySignatureText, isDraftEmail, listSenderAddresses, listedMailboxes, mailPageLabel, matchSenderAddresses, mergeSenderAddresses, patchEmails, recipientTokenAt, replaceRecipientToken, replyQuote, replySubject, sendDraft, signatureBlock, textToHtmlSignature, uniqueSenderAddresses, updateIdentitySignatures } from "./mail";
import type { JmapClient } from "./client";
import type { Email } from "../types";

describe("mailbox list order", () => {
  it("keeps Inbox first so a narrow screen does not scroll it away", () => {
    const ordered = listedMailboxes([
      { id: "archive", name: "Archive", role: "archive", sortOrder: 0 },
      { id: "projects", name: "Projects", sortOrder: 1 },
      { id: "inbox", name: "Inbox", role: "inbox", sortOrder: 20 },
      { id: "drafts", name: "Drafts", role: "drafts", sortOrder: 3 },
    ]);
    expect(ordered.map((box) => box.name)).toEqual(["Inbox", "Drafts", "Archive", "Projects"]);
  });
});

describe("sender suggestions", () => {
  const senders = [
    { name: "Bob Stone", email: "bob@example.test" },
    { name: "Ada Lovelace", email: "ada@example.test" },
    { name: "", email: "notes@example.test" },
  ];

  it("includes people this account sent mail to and skips this account", () => {
    expect(uniqueSenderAddresses([
      {
        to: [{ name: "Bea Quinn", email: "bea@example.test" }, { email: "ada@example.test" }],
        cc: [{ name: "Ned Cole", email: "ned@example.test" }],
        bcc: [{ name: "Bea Again", email: "Bea@example.test" }],
      },
    ], ["ada@example.test"], ["to", "cc", "bcc"])).toEqual([
      { name: "Bea Quinn", email: "bea@example.test" },
      { name: "Ned Cole", email: "ned@example.test" },
    ]);
  });

  it("keeps the newest sender for each address and skips this account", () => {
    expect(uniqueSenderAddresses([
      { from: [{ name: "Bob Stone", email: "bob@example.test" }, { email: "ada@example.test" }] },
      { from: [{ name: "Robert", email: "Bob@example.test" }] },
      { from: [{ name: "Notes", email: "notes@example.test" }] },
    ], ["ada@example.test"])).toEqual([
      { name: "Bob Stone", email: "bob@example.test" },
      { name: "Notes", email: "notes@example.test" },
    ]);
  });

  it("matches a typed name or address and keeps the recent order within a rank", () => {
    expect(matchSenderAddresses(senders, "a").map((sender) => sender.email)).toEqual(["ada@example.test", "bob@example.test", "notes@example.test"]);
    expect(matchSenderAddresses(senders, "stone").map((sender) => sender.email)).toEqual(["bob@example.test"]);
    expect(matchSenderAddresses(senders, "")).toEqual([]);
  });

  it("replaces only the address being typed", () => {
    const value = "ada@example.test, bo";
    const token = recipientTokenAt(value, value.length);
    expect(token.text).toBe("bo");
    expect(replaceRecipientToken(value, token, "bob@example.test")).toBe("ada@example.test, bob@example.test");
  });

  it("asks for people who emailed this account and people this account sent mail to", async () => {
    let calls: Array<[string, Record<string, unknown>, string]> = [];
    const client = {
      mailAccountId: "account-1",
      request: async (_using: unknown, methodCalls: Array<[string, Record<string, unknown>, string]>) => {
        calls = methodCalls;
        return {
          methodResponses: [
            ["Email/query", { ids: ["m1"] }, "query"],
            ["Email/get", { list: [{ id: "m1", from: [{ name: "Bob Stone", email: "bob@example.test" }] }] }, "get"],
            ["Email/query", { ids: ["s1"] }, "sentQuery"],
            ["Email/get", { list: [{ id: "s1", to: [{ name: "Bea Quinn", email: "bea@example.test" }], cc: [{ email: "bob@example.test" }], bcc: [{ name: "Ada", email: "ada@example.test" }] }] }, "sentGet"],
          ],
        };
      },
    } as unknown as JmapClient;

    const found = await listSenderAddresses(client, [
      { id: "inbox", name: "Inbox", role: "inbox" },
      { id: "sent", name: "Sent", role: "sent" },
      { id: "drafts", name: "Drafts", role: "drafts" },
      { id: "junk", name: "Junk", role: "junk" },
      { id: "trash", name: "Trash", role: "trash" },
    ], { from: "bo", ownEmails: ["ada@example.test"] });

    expect(found).toEqual([
      { name: "Bob Stone", email: "bob@example.test" },
      { name: "Bea Quinn", email: "bea@example.test" },
    ]);
    expect(calls[0][1]).toMatchObject({
      filter: { operator: "AND", conditions: [{ inMailboxOtherThan: ["sent", "drafts", "junk", "trash"] }, { from: "bo" }] },
      sort: [{ property: "receivedAt", isAscending: false }],
    });
    expect(calls[2][1]).toMatchObject({
      filter: { operator: "AND", conditions: [{ inMailbox: "sent" }, { operator: "OR", conditions: [{ to: "bo" }, { cc: "bo" }, { bcc: "bo" }] }] },
    });
    expect(calls[3][1]).toMatchObject({ properties: ["id", "to", "cc", "bcc"] });
  });

  it("appends senders that were not in the recent list", () => {
    expect(mergeSenderAddresses(senders.slice(0, 1), [senders[1], senders[0]]).map((sender) => sender.email)).toEqual([
      "bob@example.test",
      "ada@example.test",
    ]);
  });
});

describe("MIME draft builder", () => {
  it("removes injected header lines and preserves Unicode", async () => {
    const blob = await buildMimeMessage({ to: "reader@example.test", subject: "Hello\r\nBcc: intruder@example.test", body: "Hej 👋" }, {
      id: "one", name: "Ada", email: "ada@example.test",
    });
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toContain("Subject: Hello Bcc: intruder@example.test");
    expect(text).not.toContain("\r\nBcc: intruder@example.test");
    expect(text).toContain("Hej 👋");
  });

  it("sends a multipart alternative when the draft has HTML", async () => {
    const blob = await buildMimeMessage({
      to: "reader@example.test",
      subject: "Hello",
      body: "Hello",
      htmlBody: "<p><b>Hello</b></p>",
    }, { id: "one", name: "Ada", email: "ada@example.test" });
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toContain("multipart/alternative");
    expect(text).toContain("text/html");
    expect(text).toContain("<p><b>Hello</b></p>");
  });
});

describe("sendDraft", () => {
  it("moves the message to Sent instead of destroying it", async () => {
    let arguments_: Record<string, unknown> | undefined;
    const client = {
      mailAccountId: "account-1",
      call: async (_capability: unknown, method: string, args: Record<string, unknown>) => {
        expect(method).toBe("EmailSubmission/set");
        arguments_ = args;
        return { created: { send: { id: "submission-1" } } };
      },
    } as Pick<JmapClient, "mailAccountId" | "call">;

    await sendDraft(client as JmapClient, "email-1", "identity-1", "drafts-1", "sent-1");

    expect(arguments_?.onSuccessDestroyEmail).toBeUndefined();
    expect(arguments_?.onSuccessUpdateEmail).toEqual({
      "#send": {
        "mailboxIds/sent-1": true,
        "mailboxIds/drafts-1": null,
        "keywords/$draft": null,
        "keywords/$seen": true,
      },
    });
  });
});

describe("isDraftEmail", () => {
  it("recognizes the draft keyword and the drafts mailbox", () => {
    expect(isDraftEmail({ keywords: { $draft: true }, mailboxIds: { inbox: true } })).toBe(true);
    expect(isDraftEmail({ keywords: {}, mailboxIds: { drafts: true } }, "drafts")).toBe(true);
    expect(isDraftEmail({ keywords: { $seen: true }, mailboxIds: { inbox: true } }, "drafts")).toBe(false);
  });
});

describe("calendar invitation parts", () => {
  it("finds Gmail application/ics attachments and text/calendar parts", async () => {
    const { findCalendarInvitationPart, isCalendarInvitationPart } = await import("./mail");
    expect(isCalendarInvitationPart({ type: "application/ics", name: "invite.ics", blobId: "1" })).toBe(true);
    expect(isCalendarInvitationPart({ type: "text/plain", name: "notes.txt" })).toBe(false);
    expect(findCalendarInvitationPart({
      attachments: [{ type: "application/ics", name: "invite.ics", blobId: "ics-1" }],
    })?.blobId).toBe("ics-1");
    expect(findCalendarInvitationPart({
      attachments: [{ type: "image/png", name: "banner.png" }],
      textBody: [{ type: "text/calendar; method=REQUEST", blobId: "cal-1" }],
    })?.blobId).toBe("cal-1");
  });
});

const mail: Email = {
  id: "mail-1",
  mailboxIds: { inbox: true },
  keywords: {},
  receivedAt: "2026-08-20T12:00:00Z",
  from: [{ name: "Bob", email: "bob@example.test" }],
  to: [{ name: "Ada", email: "ada@example.test" }],
  subject: "Lunch",
  preview: "Are you free Friday?",
  textBody: [{ partId: "text" }],
  bodyValues: { text: { value: "Are you free Friday?\nLet me know." } },
};

describe("email signatures", () => {
  it("prefers textSignature and falls back to stripped htmlSignature", () => {
    expect(identitySignatureText({ id: "1", name: "Ada", email: "ada@example.test", textSignature: "Ada Rivera\nMail" })).toBe("Ada Rivera\nMail");
    expect(identitySignatureText({ id: "1", name: "Ada", email: "ada@example.test", htmlSignature: "<p>Ada <b>Rivera</b></p>" })).toBe("Ada Rivera");
    expect(identitySignatureText({ id: "1", name: "Ada", email: "ada@example.test" })).toBe("");
    expect(identitySignatureHtml({ id: "1", name: "Ada", email: "ada@example.test", htmlSignature: "<p>Ada <img src=\"data:image/png;base64,QQ==\"></p>" })).toContain("<img");
  });

  it("adds a standard delimiter unless the signature already has one", () => {
    expect(signatureBlock("")).toBe("");
    expect(signatureBlock("Ada Rivera")).toBe("-- \nAda Rivera");
    expect(signatureBlock("-- \nAda Rivera")).toBe("-- \nAda Rivera");
  });

  it("places the signature above quoted replies and forwarded mail", () => {
    expect(composeDraftBody({ signature: "Ada Rivera" })).toContain("-- \nAda Rivera");
    expect(composeDraftBody({ signature: "Ada Rivera", quoted: replyQuote(mail) })).toMatch(/-- \nAda Rivera\n\nOn .*Bob wrote:\n> Are you free Friday\?/);
    const forwarded = composeDraftBody({ signature: "Ada Rivera", forwarded: forwardedMessage(mail) });
    expect(forwarded).toContain("---------- Forwarded message ---------");
    expect(forwarded.indexOf("Ada Rivera")).toBeLessThan(forwarded.indexOf("Forwarded message"));
    expect(replySubject("Lunch")).toBe("Re: Lunch");
    expect(replySubject("Re: Lunch")).toBe("Re: Lunch");
    expect(forwardSubject("Lunch")).toBe("Fwd: Lunch");
    expect(forwardedMessage(mail)).toContain("Let me know.");
  });

  it("saves both text and HTML signature fields", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = {
      mailAccountId: "account-1",
      call: async (_capability: unknown, method: string, args: Record<string, unknown>) => {
        expect(method).toBe("Identity/set");
        payload = args;
        return { updated: { "identity-1": null } };
      },
    } as unknown as JmapClient;
    await updateIdentitySignatures(client, "identity-1", "Ada Rivera\nMail");
    expect(payload).toEqual({
      accountId: "account-1",
      update: { "identity-1": { textSignature: "Ada Rivera\nMail", htmlSignature: textToHtmlSignature("Ada Rivera\nMail") } },
    });
    await updateIdentitySignatures(client, "identity-1", "Ada", "<p>Ada <b>Rivera</b></p>");
    expect(payload).toEqual({
      accountId: "account-1",
      update: { "identity-1": { textSignature: "Ada", htmlSignature: "<p>Ada <b>Rivera</b></p>" } },
    });
  });

  it("places HTML signatures above quoted replies", () => {
    expect(composeDraftHtml({ signatureHtml: "<p>Ada Rivera</p>" })).toContain('class="signature"');
    expect(composeDraftHtml({ signatureHtml: "<p>Ada</p>", quotedHtml: "<blockquote>Hi</blockquote>" })).toMatch(/signature[\s\S]*blockquote/);
  });
});

describe("patchEmails", () => {
  it("marks several messages seen in one Email/set", async () => {
    const call = vi.fn().mockResolvedValue({ updated: { "mail-1": null, "mail-2": null } });
    const client = { mailAccountId: "account-1", call } as unknown as JmapClient;
    await patchEmails(client, ["mail-1", "mail-2"], { "keywords/$seen": true });
    expect(call).toHaveBeenCalledWith("urn:ietf:params:jmap:mail", "Email/set", {
      accountId: "account-1",
      update: {
        "mail-1": { "keywords/$seen": true },
        "mail-2": { "keywords/$seen": true },
      },
    });
  });
});

describe("folders and starred queries", () => {
  it("creates a mailbox by name", async () => {
    const { createMailbox, userFolders } = await import("./mail");
    const call = vi.fn().mockResolvedValue({ created: { folder: { id: "projects", name: "Projects" } } });
    const created = await createMailbox({ mailAccountId: "account-1", call } as unknown as JmapClient, "  Projects  ");
    expect(created).toEqual({ id: "projects", name: "Projects", parentId: null, role: null });
    expect(call).toHaveBeenCalledWith("urn:ietf:params:jmap:mail", "Mailbox/set", {
      accountId: "account-1",
      create: { folder: { name: "Projects" } },
    });
    expect(userFolders([
      { id: "inbox", name: "Inbox", role: "inbox" },
      { id: "projects", name: "Projects" },
    ]).map((box) => box.id)).toEqual(["projects"]);
  });

  it("labels each page from the first message through the last one on that page", () => {
    expect(mailPageLabel(0, 50, 120)).toBe("1-50 of 120");
    expect(mailPageLabel(50, 50, 120)).toBe("51-100 of 120");
    expect(mailPageLabel(100, 50, 120)).toBe("101-120 of 120");
    expect(mailPageLabel(0, 100, 80)).toBe("1-80 of 80");
    expect(mailPageLabel(0, 50, 0)).toBe("");
  });

  it("queries starred mail with hasKeyword", async () => {
    const { getEmails } = await import("./mail");
    const request = vi.fn().mockResolvedValue({
      methodResponses: [
        ["Email/query", { ids: ["mail-1"], total: 1, queryState: "q" }, "query"],
        ["Email/get", { list: [{ id: "mail-1", mailboxIds: { inbox: true }, keywords: { $flagged: true }, receivedAt: "2026-08-20T12:00:00Z" }] }, "get"],
      ],
    });
    await getEmails({ mailAccountId: "account-1", request } as unknown as JmapClient, { hasKeyword: "$flagged" });
    expect(request).toHaveBeenCalledWith(
      ["urn:ietf:params:jmap:mail"],
      expect.arrayContaining([
        ["Email/query", expect.objectContaining({ filter: { hasKeyword: "$flagged" }, position: 0, limit: 50, sort: [{ property: "receivedAt", isAscending: false }] }), "query"],
      ]),
      undefined,
    );
  });

  it("can query an older page with the oldest mail first", async () => {
    const { getEmails } = await import("./mail");
    const request = vi.fn().mockResolvedValue({
      methodResponses: [
        ["Email/query", { ids: [], total: 0, queryState: "q" }, "query"],
        ["Email/get", { list: [] }, "get"],
      ],
    });
    await getEmails({ mailAccountId: "account-1", request } as unknown as JmapClient, { position: 100, limit: 100, newestFirst: false });
    expect(request).toHaveBeenCalledWith(
      ["urn:ietf:params:jmap:mail"],
      expect.arrayContaining([
        ["Email/query", expect.objectContaining({ position: 100, limit: 100, sort: [{ property: "receivedAt", isAscending: true }] }), "query"],
      ]),
      undefined,
    );
  });
});
