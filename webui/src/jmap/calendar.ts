import { CAPABILITIES, type Calendar, type CalendarEvent, type EventParticipant, type ParticipantIdentity, type ParticipationStatus } from "../types";
import { JmapClient, JmapError, findResponse } from "./client";

interface GetResult<T> { accountId: string; state: string; list: T[]; notFound?: string[] }

export async function getCalendars(client: JmapClient): Promise<Calendar[]> {
  const result = await client.call<GetResult<Calendar>>(CAPABILITIES.calendars, "Calendar/get", {
    accountId: client.calendarAccountId,
    properties: ["id", "name", "color", "sortOrder", "isVisible", "isSubscribed", "myRights"],
  });
  return result.list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export async function getParticipantIdentities(client: JmapClient): Promise<ParticipantIdentity[]> {
  const result = await client.call<GetResult<ParticipantIdentity>>(CAPABILITIES.calendars, "ParticipantIdentity/get", {
    accountId: client.calendarAccountId,
    properties: ["id", "name", "calendarAddress", "isDefault"],
  });
  return result.list;
}

export async function getCalendarEvents(client: JmapClient, start: Date, end: Date): Promise<CalendarEvent[]> {
  const response = await client.request([CAPABILITIES.calendars], [
    ["CalendarEvent/query", {
      accountId: client.calendarAccountId,
      filter: { after: toJmapLocal(start), before: toJmapLocal(end) },
      sort: [{ property: "start", isAscending: true }],
      expandRecurrences: true,
      limit: 1000,
    }, "query"],
    ["CalendarEvent/get", {
      accountId: client.calendarAccountId,
      "#ids": { resultOf: "query", name: "CalendarEvent/query", path: "/ids" },
      properties: ["id", "uid", "title", "description", "start", "duration", "timeZone", "showWithoutTime", "calendarIds", "participants", "organizerCalendarAddress", "locations", "recurrenceRules", "status", "freeBusyStatus", "color", "updated"],
      recurrenceOverridesBefore: toJmapLocal(end),
      recurrenceOverridesAfter: toJmapLocal(start),
    }, "get"],
  ]);
  return findResponse<GetResult<CalendarEvent>>(response.methodResponses, "get").list;
}

export async function getCalendarEvent(client: JmapClient, id: string): Promise<CalendarEvent> {
  const result = await client.call<GetResult<CalendarEvent>>(CAPABILITIES.calendars, "CalendarEvent/get", {
    accountId: client.calendarAccountId, ids: [id],
  });
  if (!result.list[0]) throw new JmapError("This event no longer exists.", "notFound");
  return result.list[0];
}

export async function findEventByUid(client: JmapClient, uid: string): Promise<CalendarEvent | null> {
  const response = await client.request([CAPABILITIES.calendars], [
    ["CalendarEvent/query", { accountId: client.calendarAccountId, filter: { uid }, limit: 1 }, "query"],
    ["CalendarEvent/get", { accountId: client.calendarAccountId, "#ids": { resultOf: "query", name: "CalendarEvent/query", path: "/ids" } }, "get"],
  ]);
  return findResponse<GetResult<CalendarEvent>>(response.methodResponses, "get").list[0] ?? null;
}

export async function parseCalendarAttachment(client: JmapClient, blobId: string): Promise<CalendarEvent | null> {
  if (!client.has(CAPABILITIES.calendarsParse)) return null;
  const result = await client.call<Record<string, any>>(CAPABILITIES.calendarsParse, "CalendarEvent/parse", {
    accountId: client.calendarAccountId,
    blobIds: [blobId],
  });
  const parsed = result.parsed?.[blobId];
  return Array.isArray(parsed) ? (parsed[0] as CalendarEvent | undefined) ?? null : null;
}

export async function importCalendarInvitation(
  client: JmapClient,
  parsed: CalendarEvent,
  calendarId: string,
  identities: ParticipantIdentity[],
  status: Exclude<ParticipationStatus, "needs-action"> | "needs-action" = "needs-action",
): Promise<string> {
  const own = findOwnParticipant(parsed, identities);
  const event: Record<string, unknown> = { ...parsed, calendarIds: { [calendarId]: true } };
  delete event.id;
  if (own && event.participants && status !== "needs-action") {
    const participants = structuredClone(event.participants as Record<string, EventParticipant>);
    participants[own.id] = { ...participants[own.id], participationStatus: status };
    event.participants = participants;
  }
  const result = await client.call<Record<string, any>>(CAPABILITIES.calendars, "CalendarEvent/set", {
    accountId: client.calendarAccountId,
    create: { invitation: event },
    sendSchedulingMessages: status !== "needs-action",
  });
  const id = result.created?.invitation?.id as string | undefined;
  if (!id) throw new JmapError(String(result.notCreated?.invitation?.description ?? "The invitation could not be added."), String(result.notCreated?.invitation?.type ?? "notCreated"));
  return id;
}

export interface EventInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
  description?: string;
  location?: string;
  guestAddresses?: string[];
}

export async function createCalendarEvent(client: JmapClient, input: EventInput, identities: ParticipantIdentity[] = []): Promise<string> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  const duration = Math.max(60_000, end.getTime() - start.getTime());
  const event: Record<string, unknown> = {
    "@type": "Event",
    uid: crypto.randomUUID(),
    title: input.title || "Untitled event",
    start: input.allDay ? input.start.slice(0, 10) : toJmapLocal(start),
    duration: toIsoDuration(input.allDay ? Math.max(86_400_000, duration) : duration),
    showWithoutTime: input.allDay,
    calendarIds: { [input.calendarId]: true },
    timeZone: input.allDay ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone,
    description: input.description || undefined,
    locations: input.location ? { location: { "@type": "Location", name: input.location } } : undefined,
  };
  const scheduling = eventSchedulingFields(identities, input.guestAddresses ?? []);
  if (scheduling) Object.assign(event, scheduling);
  const result = await client.call<Record<string, any>>(CAPABILITIES.calendars, "CalendarEvent/set", {
    accountId: client.calendarAccountId, create: { event }, sendSchedulingMessages: true,
  });
  const id = result.created?.event?.id as string | undefined;
  if (!id) throw new JmapError(String(result.notCreated?.event?.description ?? "The event could not be created."), String(result.notCreated?.event?.type ?? "notCreated"));
  return id;
}

export async function updateCalendarEvent(client: JmapClient, id: string, patch: Record<string, unknown>, sendSchedulingMessages = false): Promise<void> {
  const result = await client.call<Record<string, any>>(CAPABILITIES.calendars, "CalendarEvent/set", {
    accountId: client.calendarAccountId, update: { [id]: patch }, sendSchedulingMessages,
  });
  if (result.notUpdated?.[id]) throw new JmapError(String(result.notUpdated[id].description ?? "The event could not be updated."), String(result.notUpdated[id].type ?? "notUpdated"));
}

export async function destroyCalendarEvent(client: JmapClient, id: string): Promise<void> {
  await client.call(CAPABILITIES.calendars, "CalendarEvent/set", {
    accountId: client.calendarAccountId, destroy: [id], sendSchedulingMessages: true,
  });
}

export function findOwnParticipant(
  event: CalendarEvent,
  identities: ParticipantIdentity[],
): { id: string; participant: EventParticipant } | null {
  const ownAddresses = new Set(identities.map((item) => normalizeCalendarAddress(item.calendarAddress)));
  for (const [id, participant] of Object.entries(event.participants ?? {})) {
    const address = normalizeCalendarAddress(participant.calendarAddress ?? participant.email ?? "");
    if (ownAddresses.has(address)) return { id, participant };
  }
  return null;
}

export function participationStatus(event: CalendarEvent, identities: ParticipantIdentity[]): ParticipationStatus | "none" {
  return findOwnParticipant(event, identities)?.participant.participationStatus ?? "none";
}

export interface ParsedGuestAddresses {
  addresses: string[];
  invalid: string[];
}

export function parseGuestAddresses(value: string): ParsedGuestAddresses {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of value.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean)) {
    const address = normalizeCalendarAddress(item);
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) {
      invalid.push(item);
    } else if (!seen.has(address)) {
      seen.add(address);
      addresses.push(address);
    }
  }
  return { addresses, invalid };
}

export function isParticipantIdentityAddress(address: string, identities: ParticipantIdentity[]): boolean {
  const normalized = normalizeCalendarAddress(address);
  return identities.some((identity) => normalizeCalendarAddress(identity.calendarAddress) === normalized);
}

export function isEventOrganizer(event: CalendarEvent, identities: ParticipantIdentity[]): boolean {
  if (event.organizerCalendarAddress) return isParticipantIdentityAddress(event.organizerCalendarAddress, identities);
  if (!Object.keys(event.participants ?? {}).length) return true;
  return Boolean(findOwnParticipant(event, identities)?.participant.roles?.chair);
}

export function eventGuestAddresses(event: CalendarEvent, identities: ParticipantIdentity[]): string[] {
  const addresses: string[] = [];
  const seen = new Set<string>();
  for (const participant of Object.values(event.participants ?? {})) {
    if (participant.roles?.chair) continue;
    const address = normalizeCalendarAddress(participant.calendarAddress ?? participant.email ?? "");
    if (address && !seen.has(address) && !isParticipantIdentityAddress(address, identities)) {
      seen.add(address);
      addresses.push(address);
    }
  }
  return addresses;
}

export function eventSchedulingFields(
  identities: ParticipantIdentity[],
  guestAddresses: string[],
  existing?: CalendarEvent,
): { participants: Record<string, EventParticipant>; organizerCalendarAddress: string } | null {
  const guests = guestAddresses
    .map(normalizeCalendarAddress)
    .filter((address, index, all) => address && all.indexOf(address) === index && !isParticipantIdentityAddress(address, identities));
  if (!guests.length && !Object.keys(existing?.participants ?? {}).length) return null;

  const existingOrganizerAddress = normalizeCalendarAddress(existing?.organizerCalendarAddress ?? "");
  const identity = identities.find((item) => normalizeCalendarAddress(item.calendarAddress) === existingOrganizerAddress)
    ?? identities.find((item) => item.isDefault)
    ?? identities[0];
  if (!identity) throw new JmapError("This account has no calendar identity to send invitations from.", "participantIdentityNotFound");

  const existingByAddress = new Map<string, { id: string; participant: EventParticipant }>();
  for (const [id, participant] of Object.entries(existing?.participants ?? {})) {
    const address = normalizeCalendarAddress(participant.calendarAddress ?? participant.email ?? "");
    if (address) existingByAddress.set(address, { id, participant });
  }

  const organizer = normalizeCalendarAddress(identity.calendarAddress);
  const previousOrganizer = existingByAddress.get(organizer);
  const participants: Record<string, EventParticipant> = {
    [previousOrganizer?.id ?? crypto.randomUUID()]: {
      ...previousOrganizer?.participant,
      "@type": "Participant",
      name: identity.name || previousOrganizer?.participant.name,
      calendarAddress: `mailto:${organizer}`,
      roles: { ...previousOrganizer?.participant.roles, chair: true },
      participationStatus: "accepted",
    },
  };

  for (const address of guests) {
    const previous = existingByAddress.get(address);
    participants[previous?.id ?? crypto.randomUUID()] = {
      ...previous?.participant,
      "@type": "Participant",
      calendarAddress: `mailto:${address}`,
      kind: previous?.participant.kind ?? "individual",
      expectReply: previous?.participant.expectReply ?? true,
      participationStatus: previous?.participant.participationStatus ?? "needs-action",
    };
  }

  return { participants, organizerCalendarAddress: `mailto:${organizer}` };
}

export async function respondToInvitation(
  client: JmapClient,
  event: CalendarEvent,
  identities: ParticipantIdentity[],
  status: Exclude<ParticipationStatus, "needs-action">,
): Promise<void> {
  const own = findOwnParticipant(event, identities);
  if (!own) throw new JmapError("Your address is not listed as an attendee.", "participantNotFound");
  await updateCalendarEvent(client, event.id, { [`participants/${own.id}/participationStatus`]: status }, true);
}

export function toJmapLocal(date: Date): string {
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`;
}

export function eventEnd(event: CalendarEvent): Date {
  const start = new Date(event.start.length === 10 ? `${event.start}T00:00:00` : event.start);
  const match = event.duration?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return start;
  const milliseconds = ((Number(match[1] || 0) * 24 + Number(match[2] || 0)) * 60 * 60 + Number(match[3] || 0) * 60 + Number(match[4] || 0)) * 1000;
  return new Date(start.getTime() + milliseconds);
}

function normalizeCalendarAddress(value: string): string {
  return value.trim().toLowerCase().replace(/^mailto:/, "");
}

function toIsoDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days && !hours && !minutes && !seconds) return `P${days}D`;
  return `P${days ? `${days}D` : ""}T${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${seconds ? `${seconds}S` : ""}`;
}
