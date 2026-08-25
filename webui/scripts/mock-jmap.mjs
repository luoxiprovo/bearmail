import { createServer } from "node:http";

const accountId = "demo-account";
const calendarId = "personal";
const now = new Date();
const local = (dayOffset, hour, minute = 0) => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
};
const participants = (status) => ({ organizer: { name: "Mira Chen", calendarAddress: "mailto:mira@example.test", roles: { chair: true }, participationStatus: "accepted" }, ada: { name: "Ada Rivera", calendarAddress: "mailto:ada@example.test", roles: { attendee: true }, participationStatus: status, expectReply: true } });
let events = [
  { id: "event-pending", uid: "planning@example.test", title: "Quarterly planning", description: "Review goals and decide the next bets.", start: local(1, 10), duration: "PT1H", timeZone: "Etc/UTC", calendarIds: { [calendarId]: true }, organizerCalendarAddress: "mailto:mira@example.test", participants: participants("needs-action"), locations: { room: { name: "Library room" } } },
  { id: "event-accepted", uid: "design@example.test", title: "Design critique", start: local(2, 14), duration: "PT45M", timeZone: "Etc/UTC", calendarIds: { [calendarId]: true }, organizerCalendarAddress: "mailto:mira@example.test", participants: participants("accepted") },
  { id: "event-tentative", uid: "coffee@example.test", title: "Coffee with Sam", start: local(4, 9), duration: "PT30M", timeZone: "Etc/UTC", calendarIds: { [calendarId]: true }, organizerCalendarAddress: "mailto:mira@example.test", participants: participants("tentative"), locations: { cafe: { name: "Northstar Café" } } },
  { id: "event-declined", uid: "vendor@example.test", title: "Vendor introduction", start: local(5, 16), duration: "PT1H", timeZone: "Etc/UTC", calendarIds: { [calendarId]: true }, organizerCalendarAddress: "mailto:mira@example.test", participants: participants("declined") },
];
let identity = { id: "identity", name: "Ada Rivera", email: "ada@example.test", textSignature: "", htmlSignature: "" };
const emails = [
  { id: "mail-invite", blobId: "mail-invite-blob", threadId: "thread-1", mailboxIds: { inbox: true }, keywords: {}, receivedAt: new Date().toISOString(), from: [{ name: "Mira Chen", email: "mira@example.test" }], to: [{ name: "Ada Rivera", email: "ada@example.test" }], subject: "Invitation: Quarterly planning", preview: "Review goals and decide the next bets.", hasAttachment: true, textBody: [{ partId: "text-1", type: "text/plain" }], htmlBody: [{ partId: "html-1", type: "text/html" }], attachments: [{ blobId: "invite-blob", type: "text/calendar", name: "invite.ics", size: 820 }], bodyValues: { "text-1": { value: "You are invited to quarterly planning." }, "html-1": { value: "<p>Hello Ada,</p><p>You are invited to <strong>quarterly planning</strong>. The agenda is attached.</p><script>console.error('unsafe')</script>" } } },
  { id: "mail-news", blobId: "mail-news-blob", threadId: "thread-2", mailboxIds: { inbox: true }, keywords: { "$seen": true, "$flagged": true }, receivedAt: new Date(Date.now() - 3_600_000).toISOString(), from: [{ name: "Stalwart Weekly", email: "hello@example.test" }], to: [{ email: "ada@example.test" }], subject: "A quieter inbox, one shortcut at a time", preview: "Three small changes for a calmer week.", hasAttachment: false, textBody: [{ partId: "text-2", type: "text/plain" }], bodyValues: { "text-2": { value: "Three small changes for a calmer week.\n\n1. Archive decisively.\n2. Plan tomorrow today.\n3. Protect focus time." } } },
  { id: "mail-report", blobId: "mail-report-blob", threadId: "thread-3", mailboxIds: { inbox: true }, keywords: {}, receivedAt: new Date(Date.now() - 86_400_000).toISOString(), from: [{ name: "Theo Martin", email: "theo@example.test" }], to: [{ email: "ada@example.test" }], subject: "August field report", preview: "The report is ready for your review.", hasAttachment: true, textBody: [{ partId: "text-3", type: "text/plain" }], attachments: [{ blobId: "report-blob", type: "application/pdf", name: "field-report.pdf", size: 34812 }], bodyValues: { "text-3": { value: "Hi Ada,\n\nThe August field report is ready for your review.\n\nTheo" } } },
];

const capabilities = { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {}, "urn:ietf:params:jmap:submission": {}, "urn:ietf:params:jmap:calendars": {}, "urn:ietf:params:jmap:calendars:parse": {}, "urn:ietf:params:jmap:sieve": {} };
const session = { capabilities, accounts: { [accountId]: { name: "Ada Rivera", isPersonal: true, isReadOnly: false, accountCapabilities: capabilities } }, primaryAccounts: { "urn:ietf:params:jmap:mail": accountId, "urn:ietf:params:jmap:calendars": accountId }, username: "ada@example.test", apiUrl: "http://127.0.0.1:4181/jmap", uploadUrl: "http://127.0.0.1:4181/upload/{accountId}", downloadUrl: "http://127.0.0.1:4181/download/{accountId}/{blobId}/{name}", eventSourceUrl: "http://127.0.0.1:4181/events", state: "demo-1" };

createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1:4181");
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" };
  if (request.method === "OPTIONS") return respond(response, 204, "", headers);
  if (url.pathname === "/.well-known/jmap" || url.pathname === "/jmap/session") return respond(response, 200, session, headers);
  if (url.pathname.startsWith("/upload/")) return respond(response, 201, { accountId, blobId: `upload-${Date.now()}`, type: request.headers["content-type"], size: Number(request.headers["content-length"] || 0) }, headers);
  if (url.pathname.startsWith("/download/")) return respond(response, 200, "Demo attachment\n", { ...headers, "Content-Type": "application/octet-stream" });
  if (url.pathname !== "/jmap" || request.method !== "POST") return respond(response, 404, { error: "notFound" }, headers);
  const body = JSON.parse(await readBody(request));
  const methodResponses = body.methodCalls.map(([name, args, tag]) => [name, handle(name, args), tag]);
  return respond(response, 200, { methodResponses, sessionState: session.state }, headers);
}).listen(4181, "127.0.0.1", () => console.log("Mock JMAP listening on http://127.0.0.1:4181"));

function handle(name, args) {
  if (name === "Mailbox/get") return { accountId, state: "mailbox-1", list: [
    { id: "inbox", name: "Inbox", role: "inbox", sortOrder: 1, totalEmails: emails.length, unreadEmails: 2 },
    { id: "drafts", name: "Drafts", role: "drafts", sortOrder: 2, totalEmails: 0, unreadEmails: 0 },
    { id: "sent", name: "Sent", role: "sent", sortOrder: 3, totalEmails: 12, unreadEmails: 0 },
    { id: "archive", name: "Archive", role: "archive", sortOrder: 4, totalEmails: 86, unreadEmails: 0 },
    { id: "trash", name: "Trash", role: "trash", sortOrder: 5, totalEmails: 2, unreadEmails: 0 },
    { id: "junk", name: "Junk", role: "junk", sortOrder: 6, totalEmails: 0, unreadEmails: 0 },
  ] };
  if (name === "SieveScript/query") return { accountId, ids: [] };
  if (name === "SieveScript/get") return { accountId, list: [] };
  if (name === "SieveScript/set") return { accountId, created: { blocked: { id: "sieve-blocked" } }, updated: args.update ? Object.fromEntries(Object.keys(args.update).map((id) => [id, null])) : undefined };
  if (name === "Identity/get") return { accountId, state: "identity-1", list: [identity] };
  if (name === "Identity/set") {
    Object.entries(args.update || {}).forEach(([, patch]) => { Object.assign(identity, patch); });
    return { accountId, oldState: "identity-1", newState: "identity-2", updated: Object.fromEntries(Object.keys(args.update || {}).map((id) => [id, null])) };
  }
  if (name === "Calendar/get") return { accountId, state: "calendar-1", list: [{ id: calendarId, name: "Personal", color: "#287f77", sortOrder: 1, isVisible: true, isSubscribed: true, myRights: { mayWriteAll: true } }, { id: "team", name: "Team", color: "#d84e66", sortOrder: 2, isVisible: true, isSubscribed: true }] };
  if (name === "ParticipantIdentity/get") return { accountId, state: "participant-1", list: [{ id: "ada", name: "Ada Rivera", calendarAddress: "mailto:ada@example.test", isDefault: true }] };
  if (name === "Email/query") { const filtered = args.filter?.text ? emails.filter((email) => JSON.stringify(email).toLowerCase().includes(String(args.filter.text).toLowerCase())) : emails.filter((email) => !args.filter?.inMailbox || email.mailboxIds[args.filter.inMailbox]); return { accountId, queryState: "email-query-1", canCalculateChanges: true, position: 0, ids: filtered.map((email) => email.id), total: filtered.length }; }
  if (name === "Email/get") { const ids = args.ids || emails.map((email) => email.id); return { accountId, state: "email-1", list: emails.filter((email) => ids.includes(email.id)) }; }
  if (name === "Email/set") { Object.entries(args.update || {}).forEach(([id, patch]) => { const email = emails.find((item) => item.id === id); if (!email) return; Object.entries(patch).forEach(([key, value]) => { const [group, item] = key.split("/"); if (group === "keywords") value == null ? delete email.keywords[item] : email.keywords[item] = value; if (group === "mailboxIds") value == null ? delete email.mailboxIds[item] : email.mailboxIds[item] = value; }); }); return { accountId, oldState: "email-1", newState: "email-2", updated: Object.fromEntries(Object.keys(args.update || {}).map((id) => [id, null])) }; }
  if (name === "Email/import") return { accountId, oldState: "email-1", newState: "email-2", created: { draft: { id: `draft-${Date.now()}`, blobId: "draft-blob", size: 100 } } };
  if (name === "EmailSubmission/set") return { accountId, oldState: "submission-1", newState: "submission-2", created: { send: { id: `submission-${Date.now()}` } } };
  if (name === "CalendarEvent/query") return { accountId, queryState: "event-query-1", canCalculateChanges: true, position: 0, ids: args.filter?.uid ? events.filter((event) => event.uid === args.filter.uid).map((event) => event.id) : events.map((event) => event.id), total: events.length };
  if (name === "CalendarEvent/get") { const ids = args.ids || events.map((event) => event.id); return { accountId, state: "event-1", list: events.filter((event) => ids.includes(event.id)) }; }
  if (name === "CalendarEvent/parse") return { accountId, parsed: { "invite-blob": [events[0]] } };
  if (name === "CalendarEvent/set") { const created = {}; Object.entries(args.create || {}).forEach(([key, event]) => { const id = `event-${Date.now()}`; events.push({ ...event, id }); created[key] = { id }; }); Object.entries(args.update || {}).forEach(([id, patch]) => { const event = events.find((item) => item.id === id); if (!event) return; Object.entries(patch).forEach(([key, value]) => { if (key.startsWith("participants/")) { const [, participantId, field] = key.split("/"); event.participants[participantId][field] = value; } else event[key] = value; }); }); events = events.filter((event) => !(args.destroy || []).includes(event.id)); return { accountId, oldState: "event-1", newState: "event-2", created, updated: Object.fromEntries(Object.keys(args.update || {}).map((id) => [id, null])), destroyed: args.destroy || [] }; }
  return { type: "unknownMethod", description: name };
}

function readBody(request) { return new Promise((resolve, reject) => { let data = ""; request.on("data", (chunk) => { data += chunk; }); request.on("end", () => resolve(data)); request.on("error", reject); }); }
function respond(response, status, value, headers) { response.writeHead(status, headers); response.end(typeof value === "string" ? value : JSON.stringify(value)); }
