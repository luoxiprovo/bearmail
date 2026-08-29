import { afterEach, describe, expect, it } from "vitest";
import { BearmailAccount } from "../src/account.js";
import { loadConfig, type BearmailConfig } from "../src/config.js";
import { BasicAuthProvider, discoverSession, JmapClient } from "../src/jmap.js";
import { startMockJmap, type MockJmap } from "./mock-jmap.js";

let mock: MockJmap | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function connect(overrides: Partial<BearmailConfig> = {}, mockOptions?: Parameters<typeof startMockJmap>[0]) {
  mock = await startMockJmap(mockOptions);
  const config = {
    ...loadConfig({
      BEARMAIL_SERVER: mock.origin,
      BEARMAIL_USERNAME: "ada@example.test",
      BEARMAIL_PASSWORD: "app-pass",
      BEARMAIL_SEND_MODE: "send-allowed",
      BEARMAIL_SCOPES: "mail.read,mail.send,mail.draft,calendar.read,calendar.write",
    }),
    ...overrides,
  };
  const auth = new BasicAuthProvider("ada@example.test", "app-pass");
  const { session } = await discoverSession(mock.origin, auth);
  return { account: new BearmailAccount(new JmapClient(session, auth, mock.origin), config), mock };
}

describe("BearmailAccount", () => {
  it("reports whoami with capabilities, scopes, and tools", async () => {
    const { account } = await connect();
    const who = await account.run("whoami", () => account.whoami());
    expect(who.username).toBe("ada@example.test");
    expect(who.scopes).toContain("mail.read");
    expect(who.tools).toEqual(expect.arrayContaining(["send_email", "create_event", "list_inbox"]));
    expect(who.sendMode).toBe("send-allowed");
    expect(who.pushMode).toBe("poll");
  });

  it("lists unread inbox without bodies", async () => {
    const { account } = await connect();
    const page = await account.run("list_inbox", () => account.listInbox({ unread: true }));
    expect(page.emails).toHaveLength(1);
    expect(page.emails[0].id).toBe("mail-html");
    expect(page.emails[0]).not.toHaveProperty("body");
    expect(page.emails[0].preview).toBeTruthy();
  });

  it("strips HTML and flags active content in get_thread", async () => {
    const { account } = await connect();
    const thread = await account.run("get_thread", () => account.getThread("mail-html"));
    expect(thread.warning).toMatch(/untrusted/i);
    expect(thread.messages[0].body.untrusted_content).toBe(true);
    expect(thread.messages[0].body.text).toContain("Hi Ada");
    expect(thread.messages[0].body.text).not.toMatch(/<script/i);
    expect(thread.messages[0].hadActiveHtml).toBe(true);
    expect(thread.messages[0].html).toBeUndefined();
  });

  it("saves a draft without submitting when send mode is draft-only", async () => {
    const { account, mock: server } = await connect({ sendMode: "draft-only" });
    const result = await account.run("send_email", () => account.sendEmail({
      to: ["mira@example.test"],
      subject: "Ping",
      body: "Are you free at 3?",
    }));
    expect(result.status).toBe("draft");
    expect(result.emailId).toMatch(/^draft-/);
    expect(server.lastSubmission).toBeUndefined();
  });

  it("submits through EmailSubmission/set and moves Drafts to Sent", async () => {
    const { account, mock: server } = await connect();
    const result = await account.run("send_email", () => account.sendEmail({
      to: ["mira@example.test"],
      subject: "Ping",
      body: "Hello",
    }));
    expect(result.status).toBe("sent");
    expect(server.lastSubmission?.onSuccessUpdateEmail).toEqual({
      "#send": {
        "mailboxIds/sent": true,
        "mailboxIds/drafts": null,
        "keywords/$draft": null,
        "keywords/$seen": true,
      },
    });
    expect(server.lastSubmission).not.toHaveProperty("onSuccessDestroyEmail");
  });

  it("rejects send when mail.send is missing", async () => {
    const { account } = await connect({
      scopes: new Set(["mail.read", "mail.draft", "calendar.read", "calendar.write"]),
    });
    expect(account.advertisedTools()).not.toContain("send_email");
    await expect(account.run("send_email", () => account.sendEmail({
      to: ["mira@example.test"], subject: "X", body: "Y",
    }))).rejects.toMatchObject({ code: "missingScope" });
  });

  it("omits calendar tools when calendars are not advertised", async () => {
    const { account } = await connect({}, { calendars: false });
    expect(account.advertisedTools()).not.toContain("create_event");
    await expect(account.run("create_event", () => account.createEvent({
      title: "No", start: "2026-08-28T11:00:00", end: "2026-08-28T11:30:00",
    }))).rejects.toMatchObject({ code: "capabilityMissing" });
  });

  it("creates an event with attendees and sendSchedulingMessages", async () => {
    const { account, mock: server } = await connect();
    const created = await account.run("create_event", () => account.createEvent({
      title: "Sync",
      start: "2026-08-28T16:00:00",
      end: "2026-08-28T16:30:00",
      attendees: ["guest@gmail.com"],
    }));
    expect(created.schedulingSent).toBe(true);
    expect(server.lastCalendarSet?.sendSchedulingMessages).toBe(true);
    expect(created.event.sequence).toBe(1);
    const listed = await account.listEvents({ after: "2026-08-28T00:00:00", before: "2026-08-29T00:00:00" });
    expect(listed.events.some((event) => event.id === created.event.id)).toBe(true);
  });

  it("creates a series with extra occurrences as recurrenceOverrides", async () => {
    const { account, mock: server } = await connect();
    const created = await account.run("create_event", () => account.createEvent({
      title: "Panthers",
      start: "2026-09-06T13:00:00",
      end: "2026-09-06T16:00:00",
      attendees: ["guest@gmail.com"],
      occurrences: [
        { start: "2026-09-06T13:00:00", end: "2026-09-06T16:00:00" },
        { start: "2026-09-13T13:00:00", end: "2026-09-13T16:00:00" },
        { start: "2026-09-20T16:25:00", end: "2026-09-20T19:25:00", title: "Panthers at Cardinals" },
      ],
    }));
    const createdEvent = server.lastCalendarSet?.create?.event as {
      recurrenceOverrides?: Record<string, Record<string, unknown>>;
      recurrenceRule?: Record<string, unknown>;
      participants?: Record<string, unknown>;
      organizerCalendarAddress?: string;
    };
    expect(createdEvent.recurrenceRule).toEqual({
      "@type": "RecurrenceRule",
      frequency: "weekly",
      until: "2026-09-20T16:25:00",
      byDay: [{ "@type": "NDay", day: "su" }],
    });
    const moved = createdEvent.recurrenceOverrides?.["2026-09-20T13:00:00"] as Record<string, unknown>;
    expect(moved.title).toBe("Panthers at Cardinals");
    expect(moved.start).toBe("2026-09-20T16:25:00");
    expect(moved.participants).toEqual(createdEvent.participants);
    expect(moved.organizerCalendarAddress).toBe(createdEvent.organizerCalendarAddress);
    expect(createdEvent.recurrenceOverrides?.["2026-09-13T13:00:00"]).toBeUndefined();
    expect(created.schedulingSent).toBe(true);
  });

  it("creates a weekly recurrence rule", async () => {
    const { account, mock: server } = await connect();
    await account.run("create_event", () => account.createEvent({
      title: "Stand-up",
      start: "2026-09-01T09:00:00",
      end: "2026-09-01T09:15:00",
      recurrence: { frequency: "weekly", until: "2026-09-29T09:00:00", byDay: ["tu"] },
    }));
    const createdEvent = server.lastCalendarSet?.create?.event as { recurrenceRule?: Record<string, unknown> };
    expect(createdEvent.recurrenceRule).toEqual({
      "@type": "RecurrenceRule",
      frequency: "weekly",
      until: "2026-09-29T09:00:00",
      byDay: [{ "@type": "NDay", day: "tu" }],
    });
  });

  it("reports busy intervals from get_availability", async () => {
    const { account } = await connect();
    const availability = await account.run("get_availability", () => account.getAvailability({
      after: "2026-08-28T00:00:00",
      before: "2026-08-29T00:00:00",
    }));
    expect(availability.busy.some((item) => item.uid === "busy@example.test")).toBe(true);
  });

  it("RSVPs and cancels as organizer", async () => {
    const { account } = await connect();
    const rsvp = await account.run("rsvp", () => account.rsvp({ eventId: "event-invite", status: "accepted" }));
    expect(rsvp.status).toBe("accepted");
    const cancelled = await account.run("cancel_event", () => account.cancelEvent("event-busy"));
    expect(cancelled.destroyed).toBe("event-busy");
  });

  it("downloads a size-capped attachment as base64", async () => {
    const { account } = await connect();
    const file = await account.run("download_attachment", () => account.downloadAttachment("file-1", "note.txt"));
    expect(file.encoding).toBe("base64");
    expect(Buffer.from(file.data, "base64").toString()).toBe("hello");
  });

  it("converts HTML-only bodies and still drops scripts", async () => {
    const { account } = await connect();
    const thread = await account.run("get_thread", () => account.getThread("mail-html-only"));
    expect(thread.messages[0].body.text).toContain("Converted body");
    expect(thread.messages[0].body.text).not.toMatch(/<script/i);
    expect(thread.messages[0].hadActiveHtml).toBe(true);
  });
});

describe("loadConfig", () => {
  it("defaults to draft-only and loopback HTTP", () => {
    const config = loadConfig({
      BEARMAIL_SERVER: "https://mail.example.com",
      BEARMAIL_USERNAME: "agent@example.com",
      BEARMAIL_TOKEN: "token",
    });
    expect(config.sendMode).toBe("draft-only");
    expect(config.scopes.has("mail.send")).toBe(false);
    expect(config.httpHost).toBe("127.0.0.1");
  });

  it("rejects credentials in the server URL", () => {
    expect(() => loadConfig({ BEARMAIL_SERVER: "https://user:pass@mail.example.com" })).toThrow(/credentials/i);
  });

  it("requires TLS cert and key for a non-loopback HTTP bind", () => {
    expect(() => loadConfig({
      BEARMAIL_SERVER: "https://mail.example.com",
      BEARMAIL_MCP_HOST: "0.0.0.0",
    })).toThrow(/TLS/);
  });
});
