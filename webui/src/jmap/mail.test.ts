import { describe, expect, it, vi } from "vitest";
import { buildMimeMessage, composeDraftBody, composeDraftHtml, forwardedMessage, forwardSubject, identitySignatureHtml, identitySignatureText, isDraftEmail, patchEmails, replyQuote, replySubject, sendDraft, signatureBlock, textToHtmlSignature, updateIdentitySignatures } from "./mail";
import type { JmapClient } from "./client";
import type { Email } from "../types";

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
        ["Email/query", expect.objectContaining({ filter: { hasKeyword: "$flagged" } }), "query"],
      ]),
      undefined,
    );
  });
});
