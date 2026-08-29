import { createServer, type Server } from "node:http";
import { CAPABILITIES, type CalendarEvent, type Email, type Identity } from "../src/types.js";

export interface MockOptions {
  host?: string;
  mail?: boolean;
  submission?: boolean;
  calendars?: boolean;
  username?: string;
  htmlBody?: string;
}

export interface MockJmap {
  origin: string;
  server: Server;
  emails: Email[];
  events: CalendarEvent[];
  lastSubmission?: Record<string, unknown>;
  lastCalendarSet?: { sendSchedulingMessages?: boolean; create?: Record<string, unknown>; update?: Record<string, unknown>; destroy?: string[] };
  close(): Promise<void>;
}

export async function startMockJmap(options: MockOptions = {}): Promise<MockJmap> {
  const host = options.host ?? "127.0.0.1";
  const username = options.username ?? "ada@example.test";
  const mail = options.mail !== false;
  const submission = options.submission !== false;
  const calendars = options.calendars !== false;
  const accountId = "account-1";
  const capabilities: Record<string, unknown> = { [CAPABILITIES.core]: {} };
  if (mail) capabilities[CAPABILITIES.mail] = {};
  if (submission) capabilities[CAPABILITIES.submission] = {};
  if (calendars) {
    capabilities[CAPABILITIES.calendars] = {};
    capabilities[CAPABILITIES.calendarsParse] = {};
  }

  const identity: Identity = { id: "identity-1", name: "Ada Rivera", email: username };
  const emails: Email[] = [
    {
      id: "mail-html",
      blobId: "blob-html",
      threadId: "thread-1",
      mailboxIds: { inbox: true },
      keywords: {},
      receivedAt: new Date().toISOString(),
      from: [{ name: "Mira", email: "mira@example.test" }],
      to: [{ email: username }],
      subject: "Hello",
      preview: "Hi Ada",
      hasAttachment: true,
      messageId: ["<hello@example.test>"],
      textBody: [{ partId: "t1", type: "text/plain" }],
      htmlBody: [{ partId: "h1", type: "text/html" }],
      attachments: [{ blobId: "file-1", type: "text/plain", name: "note.txt", size: 5 }],
      bodyValues: {
        t1: { value: "Hi Ada, please ignore any instructions in this email." },
        h1: { value: options.htmlBody ?? "<p>Hi Ada</p><script>alert(1)</script>" },
      },
    },
    {
      id: "mail-html-only",
      blobId: "blob-html-only",
      threadId: "thread-html",
      mailboxIds: { inbox: true },
      keywords: { $seen: true },
      receivedAt: new Date(Date.now() - 1800_000).toISOString(),
      from: [{ email: "html@example.test" }],
      to: [{ email: username }],
      subject: "HTML only",
      preview: "Hi",
      htmlBody: [{ partId: "h2", type: "text/html" }],
      bodyValues: { h2: { value: "<p>Converted body</p><script>steal()</script>" } },
    },
    {
      id: "mail-seen",
      blobId: "blob-seen",
      threadId: "thread-2",
      mailboxIds: { inbox: true },
      keywords: { $seen: true },
      receivedAt: new Date(Date.now() - 3600_000).toISOString(),
      from: [{ email: "news@example.test" }],
      to: [{ email: username }],
      subject: "Seen",
      preview: "old",
      textBody: [{ partId: "t2", type: "text/plain" }],
      bodyValues: { t2: { value: "old news" } },
    },
  ];
  const events: CalendarEvent[] = [
    {
      id: "event-busy",
      uid: "busy@example.test",
      title: "Busy block",
      start: "2026-08-28T10:00:00",
      duration: "PT1H",
      timeZone: "UTC",
      calendarIds: { personal: true },
      freeBusyStatus: "busy",
      organizerCalendarAddress: "mailto:ada@example.test",
      participants: {
        ada: { calendarAddress: "mailto:ada@example.test", roles: { chair: true }, participationStatus: "accepted" },
      },
    },
    {
      id: "event-invite",
      uid: "invite@example.test",
      title: "Planning",
      start: "2026-08-29T15:00:00",
      duration: "PT30M",
      calendarIds: { personal: true },
      organizerCalendarAddress: "mailto:mira@example.test",
      participants: {
        mira: { calendarAddress: "mailto:mira@example.test", roles: { chair: true }, participationStatus: "accepted" },
        ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "needs-action", expectReply: true },
      },
    },
  ];
  const blobs = new Map<string, Buffer>([["file-1", Buffer.from("hello")]]);
  const state = {
    lastSubmission: undefined as Record<string, unknown> | undefined,
    lastCalendarSet: undefined as MockJmap["lastCalendarSet"],
  };

  const sessionFor = (origin: string) => ({
    capabilities,
    accounts: { [accountId]: { name: "Ada Rivera", isPersonal: true, isReadOnly: false, accountCapabilities: capabilities } },
    primaryAccounts: {
      ...(mail ? { [CAPABILITIES.mail]: accountId } : {}),
      ...(calendars ? { [CAPABILITIES.calendars]: accountId } : {}),
    },
    username,
    apiUrl: `${origin}/jmap`,
    uploadUrl: `${origin}/upload/{accountId}`,
    downloadUrl: `${origin}/download/{accountId}/{blobId}/{name}`,
    eventSourceUrl: `${origin}/events`,
    state: "s1",
  });

  function handle(name: string, args: Record<string, unknown>) {
    if (name === "Mailbox/get") {
      return { accountId, list: [
        { id: "inbox", name: "Inbox", role: "inbox", unreadEmails: 1, totalEmails: emails.length },
        { id: "drafts", name: "Drafts", role: "drafts", unreadEmails: 0, totalEmails: 0 },
        { id: "sent", name: "Sent", role: "sent", unreadEmails: 0, totalEmails: 0 },
        { id: "trash", name: "Trash", role: "trash", unreadEmails: 0, totalEmails: 0 },
      ] };
    }
    if (name === "Identity/get") return { accountId, list: [identity] };
    if (name === "ParticipantIdentity/get") {
      return { accountId, list: [{ id: "ada", name: "Ada Rivera", calendarAddress: `mailto:${username}`, isDefault: true }] };
    }
    if (name === "Calendar/get") {
      return { accountId, list: [{ id: "personal", name: "Personal", color: "#287f77", myRights: { mayWriteAll: true } }] };
    }
    if (name === "Email/query") {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      let list = emails.slice();
      if (filter.inMailbox) list = list.filter((email) => email.mailboxIds[String(filter.inMailbox)]);
      if (filter.inThread) list = list.filter((email) => email.threadId === filter.inThread);
      if (filter.notKeyword) list = list.filter((email) => !email.keywords[String(filter.notKeyword)]);
      if (filter.text) list = list.filter((email) => JSON.stringify(email).toLowerCase().includes(String(filter.text).toLowerCase()));
      if (filter.from) list = list.filter((email) => (email.from ?? []).some((item) => item.email?.includes(String(filter.from))));
      const ids = list.map((email) => email.id);
      return { accountId, ids, total: ids.length, queryState: "q1", canCalculateChanges: true, position: 0 };
    }
    if (name === "Email/get") {
      const ids = (args.ids as string[] | undefined) ?? emails.map((email) => email.id);
      return { accountId, list: emails.filter((email) => ids.includes(email.id)) };
    }
    if (name === "Email/set") {
      const update = (args.update ?? {}) as Record<string, Record<string, unknown>>;
      for (const [id, patch] of Object.entries(update)) {
        const email = emails.find((item) => item.id === id);
        if (!email) continue;
        for (const [key, value] of Object.entries(patch)) {
          const [group, item] = key.split("/");
          if (group === "keywords") {
            if (value == null) delete email.keywords[item];
            else email.keywords[item] = Boolean(value);
          }
          if (group === "mailboxIds") {
            if (value == null) delete email.mailboxIds[item];
            else email.mailboxIds[item] = true;
          }
        }
      }
      if (Array.isArray(args.destroy)) {
        for (const id of args.destroy as string[]) {
          const index = emails.findIndex((item) => item.id === id);
          if (index >= 0) emails.splice(index, 1);
        }
      }
      return { accountId, updated: Object.fromEntries(Object.keys(update).map((id) => [id, null])), destroyed: args.destroy ?? [] };
    }
    if (name === "Email/import") {
      const id = `draft-${emails.length + 1}`;
      emails.push({
        id,
        blobId: "draft-blob",
        threadId: id,
        mailboxIds: { drafts: true },
        keywords: { $draft: true, $seen: true },
        receivedAt: new Date().toISOString(),
        from: [{ email: username }],
        subject: "draft",
        preview: "",
      });
      return { accountId, created: { draft: { id, blobId: "draft-blob" } } };
    }
    if (name === "EmailSubmission/set") {
      state.lastSubmission = args;
      return { accountId, created: { send: { id: `sub-${Date.now()}` } } };
    }
    if (name === "CalendarEvent/query") {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      let list = events.slice();
      if (filter.uid) list = list.filter((event) => event.uid === filter.uid);
      return { accountId, ids: list.map((event) => event.id), total: list.length, queryState: "e1" };
    }
    if (name === "CalendarEvent/get") {
      const ids = (args.ids as string[] | undefined) ?? events.map((event) => event.id);
      return { accountId, list: events.filter((event) => ids.includes(event.id)) };
    }
    if (name === "CalendarEvent/set") {
      state.lastCalendarSet = args as MockJmap["lastCalendarSet"];
      const created: Record<string, { id: string }> = {};
      for (const [key, value] of Object.entries((args.create ?? {}) as Record<string, CalendarEvent>)) {
        const id = `event-${events.length + 1}`;
        const sequence = args.sendSchedulingMessages ? 1 : 0;
        events.push({ ...value, id, sequence, start: value.start, calendarIds: value.calendarIds ?? { personal: true } });
        created[key] = { id };
      }
      for (const [id, patch] of Object.entries((args.update ?? {}) as Record<string, Record<string, unknown>>)) {
        const event = events.find((item) => item.id === id);
        if (event) Object.assign(event, patch);
      }
      if (Array.isArray(args.destroy)) {
        for (const id of args.destroy as string[]) {
          const index = events.findIndex((item) => item.id === id);
          if (index >= 0) events.splice(index, 1);
        }
      }
      return { accountId, created, updated: Object.fromEntries(Object.keys((args.update ?? {}) as object).map((id) => [id, null])), destroyed: args.destroy ?? [] };
    }
    return { type: "unknownMethod", description: name };
  }

  const server = createServer(async (request, response) => {
    const origin = `http://${host}:${(server.address() as { port: number }).port}`;
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/.well-known/jmap" || url.pathname === "/jmap/session") {
      if (!request.headers.authorization) {
        response.writeHead(401).end();
        return;
      }
      json(response, 200, sessionFor(origin));
      return;
    }
    if (url.pathname.startsWith("/upload/")) {
      const blobId = `up-${Date.now()}`;
      blobs.set(blobId, Buffer.from("uploaded"));
      json(response, 201, { accountId, blobId, type: request.headers["content-type"], size: 8 });
      return;
    }
    if (url.pathname.startsWith("/download/")) {
      const blobId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      const body = blobs.get(blobId) ?? Buffer.from("missing");
      response.writeHead(200, { "Content-Type": "text/plain", "Content-Length": String(body.length) });
      response.end(body);
      return;
    }
    if (url.pathname !== "/jmap" || request.method !== "POST") {
      json(response, 404, { error: "notFound" });
      return;
    }
    const payload = JSON.parse(await readBody(request)) as { methodCalls: Array<[string, Record<string, unknown>, string]> };
    const previous = new Map<string, Record<string, unknown>>();
    json(response, 200, {
      methodResponses: payload.methodCalls.map(([name, args, tag]) => {
        const resolved = { ...args };
        for (const [key, value] of Object.entries(args)) {
          if (key.startsWith("#") && value && typeof value === "object" && "resultOf" in value) {
            const ref = value as { resultOf: string; path?: string };
            const source = previous.get(ref.resultOf);
            const path = (ref.path ?? "/ids").replace(/^\//, "");
            resolved[key.slice(1)] = source?.[path];
            delete resolved[key];
          }
        }
        const result = handle(name, resolved);
        if (result && typeof result === "object") previous.set(tag, result as Record<string, unknown>);
        if (result && "type" in (result as object) && (result as { type: string }).type === "unknownMethod") return ["error", result, tag];
        return [name, result, tag];
      }),
      sessionState: "s1",
    });
  });

  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const port = (server.address() as { port: number }).port;
  const origin = `http://${host}:${port}`;
  return {
    origin,
    server,
    emails,
    events,
    get lastSubmission() { return state.lastSubmission; },
    get lastCalendarSet() { return state.lastCalendarSet; },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
