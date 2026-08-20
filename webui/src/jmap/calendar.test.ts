import { describe, expect, it, vi } from "vitest";
import { createCalendarEvent, eventEnd, eventFromParsedInvitation, eventGuestAddresses, eventSchedulingFields, findEventByUid, findOwnParticipant, importCalendarInvitation, importUnansweredInvitesFromMail, isEventOrganizer, parseCalendarAttachment, parseGuestAddresses, participationStatus, showsOnCalendar, toJmapLocal, withOwnAttendee } from "./calendar";
import type { JmapClient } from "./client";
import { CAPABILITIES, type CalendarEvent, type ParticipantIdentity } from "../types";

const identities: ParticipantIdentity[] = [{ id: "me", name: "Ada", calendarAddress: "mailto:ada@example.test", isDefault: true }];
const event: CalendarEvent = {
  id: "event", start: "2026-08-05T09:30:00", duration: "PT1H15M", calendarIds: { calendar: true },
  participants: { ada: { calendarAddress: "ADA@example.test", participationStatus: "needs-action" } },
};

describe("calendar helpers", () => {
  it("matches participant identities without case or mailto differences", () => {
    expect(findOwnParticipant(event, identities)?.id).toBe("ada");
    expect(participationStatus(event, identities)).toBe("needs-action");
  });

  it("computes event duration", () => {
    expect(eventEnd(event).toISOString()).toContain("10:45:00");
    expect(eventEnd({ ...event, start: "2026-08-05", duration: "P1D", showWithoutTime: true }).getDate()).toBe(6);
  });

  it("formats local dates without adding a timezone suffix", () => {
    expect(toJmapLocal(new Date(2026, 7, 5, 9, 3, 2))).toBe("2026-08-05T09:03:02");
  });

  it("parses, normalizes, and deduplicates guest addresses", () => {
    expect(parseGuestAddresses(" Ada@Example.test, bob@example.test\nada@example.test; broken ")).toEqual({
      addresses: ["ada@example.test", "bob@example.test"],
      invalid: ["broken"],
    });
  });

  it("builds organizer and pending guest participants", () => {
    const fields = eventSchedulingFields(identities, ["guest@example.test"]);
    expect(fields?.organizerCalendarAddress).toBe("mailto:ada@example.test");
    expect(Object.values(fields?.participants ?? {})).toEqual(expect.arrayContaining([
      expect.objectContaining({ calendarAddress: "mailto:ada@example.test", participationStatus: "accepted", roles: { chair: true } }),
      expect.objectContaining({ calendarAddress: "mailto:guest@example.test", participationStatus: "needs-action", expectReply: true }),
    ]));
  });

  it("preserves RSVP state and participant IDs while editing guests", () => {
    const scheduled: CalendarEvent = {
      ...event,
      organizerCalendarAddress: "mailto:ada@example.test",
      participants: {
        organizer: { calendarAddress: "mailto:ada@example.test", roles: { chair: true }, participationStatus: "accepted" },
        guest: { calendarAddress: "mailto:guest@example.test", participationStatus: "accepted" },
      },
    };
    const fields = eventSchedulingFields(identities, ["guest@example.test", "new@example.test"], scheduled);
    expect(fields?.participants.guest.participationStatus).toBe("accepted");
    expect(fields?.participants.organizer.roles?.chair).toBe(true);
    expect(Object.values(fields?.participants ?? {})).toContainEqual(expect.objectContaining({ calendarAddress: "mailto:new@example.test", participationStatus: "needs-action" }));
    expect(Object.keys(eventSchedulingFields(identities, [], scheduled)?.participants ?? {})).toEqual(["organizer"]);
  });

  it("identifies organizers and exposes only editable guest addresses", () => {
    const scheduled: CalendarEvent = {
      ...event,
      organizerCalendarAddress: "mailto:ada@example.test",
      participants: {
        organizer: { calendarAddress: "mailto:ada@example.test", roles: { chair: true } },
        guest: { calendarAddress: "mailto:Guest@Example.test" },
      },
    };
    expect(isEventOrganizer(scheduled, identities)).toBe(true);
    expect(eventGuestAddresses(scheduled, identities)).toEqual(["guest@example.test"]);
    expect(isEventOrganizer({ ...scheduled, organizerCalendarAddress: "mailto:other@example.test" }, identities)).toBe(false);
    expect(isEventOrganizer(event, identities)).toBe(false);
  });

  it("sends scheduling messages when creating an event with guests", async () => {
    const call = vi.fn().mockResolvedValue({ created: { event: { id: "created-event" } } });
    const client = { calendarAccountId: "account", call } as unknown as JmapClient;
    await createCalendarEvent(client, {
      title: "Planning",
      start: "2026-08-07T10:00",
      end: "2026-08-07T11:00",
      allDay: false,
      calendarId: "calendar",
      guestAddresses: ["guest@example.test"],
    }, identities);
    const payload = call.mock.calls[0][2];
    expect(payload.sendSchedulingMessages).toBe(true);
    expect(payload.create.event.organizerCalendarAddress).toBe("mailto:ada@example.test");
    expect(Object.values(payload.create.event.participants)).toContainEqual(expect.objectContaining({ calendarAddress: "mailto:guest@example.test" }));
  });

  it("keeps unanswered invitations on the calendar and hides declined ones", () => {
    expect(showsOnCalendar(event, identities)).toBe(true);
    expect(showsOnCalendar({
      ...event,
      participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "accepted" } },
    }, identities)).toBe(true);
    expect(showsOnCalendar({
      ...event,
      participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "declined" } },
    }, identities)).toBe(false);
  });

  it("imports unanswered mail invitations without sending an RSVP", async () => {
    let setArgs: Record<string, unknown> | undefined;
    const call = vi.fn(async (_capability: unknown, method: string, args: Record<string, unknown> = {}) => {
      if (method === "CalendarEvent/parse") {
        return { parsed: { blob: [{ uid: "uid-1", title: "Invite", start: "2026-08-18T10:00:00", participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "needs-action" } } }] } };
      }
      if (method === "CalendarEvent/set") {
        setArgs = args;
        return { created: { invitation: { id: "imported" } } };
      }
      return {};
    });
    const request = vi.fn(async (_using: unknown, methodCalls: Array<[string, unknown, string]>) => {
      if (methodCalls[0]?.[0] === "Email/query") {
        return {
          methodResponses: [
            ["Email/query", { ids: ["mail-1"], total: 1, queryState: "q" }, "query"],
            ["Email/get", { list: [{ id: "mail-1", attachments: [{ blobId: "blob", type: "text/calendar", name: "invite.ics" }] }] }, "get"],
          ],
        };
      }
      return {
        methodResponses: [
          ["CalendarEvent/query", { ids: [] }, "query"],
          ["CalendarEvent/get", { list: [] }, "get"],
        ],
      };
    });
    const client = {
      calendarAccountId: "account",
      mailAccountId: "account",
      has: () => true,
      call,
      request,
    } as unknown as JmapClient;
    await importUnansweredInvitesFromMail(client, "calendar", identities);
    expect(setArgs?.sendSchedulingMessages).toBe(false);
    expect(call.mock.calls.find((entry) => entry[1] === "CalendarEvent/parse")?.[0]).toEqual([
      CAPABILITIES.calendars,
      CAPABILITIES.calendarsParse,
    ]);
  });

  it("asks CalendarEvent/parse with both calendars capabilities", async () => {
    const call = vi.fn().mockResolvedValue({ parsed: { blob: [{ uid: "uid-1", title: "Invite", start: "2026-08-18T10:00:00" }] } });
    const client = {
      calendarAccountId: "account",
      has: (capability: string) => capability === CAPABILITIES.calendarsParse,
      call,
    } as unknown as JmapClient;
    await expect(parseCalendarAttachment(client, "blob")).resolves.toEqual(expect.objectContaining({ uid: "uid-1" }));
    expect(call).toHaveBeenCalledWith(
      [CAPABILITIES.calendars, CAPABILITIES.calendarsParse],
      "CalendarEvent/parse",
      { accountId: "account", blobIds: ["blob"] },
    );
  });

  it("skips CalendarEvent/parse when calendars are unavailable", async () => {
    const call = vi.fn();
    const client = { calendarAccountId: "account", has: () => false, call } as unknown as JmapClient;
    await expect(parseCalendarAttachment(client, "blob")).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("drops parse-only properties before CalendarEvent/set create", async () => {
    const parsed = {
      ...event,
      uid: "uid-1",
      title: "Planning",
      method: "request",
      isOrigin: false,
      baseEventId: "base",
      utcStart: "2026-08-05T13:30:00Z",
      utcEnd: "2026-08-05T14:45:00Z",
      iCalendar: { name: "vevent" },
    } as CalendarEvent & Record<string, unknown>;
    const created = eventFromParsedInvitation(parsed, "personal", identities, "accepted");
    expect(created).toEqual(expect.objectContaining({
      uid: "uid-1",
      title: "Planning",
      start: "2026-08-05T09:30:00",
      calendarIds: { personal: true },
      participants: { ada: expect.objectContaining({ participationStatus: "accepted" }) },
    }));
    expect(created.id).toBeUndefined();
    expect(created.method).toBeUndefined();
    expect(created.isOrigin).toBeUndefined();
    expect(created.baseEventId).toBeUndefined();
    expect(created.utcStart).toBeUndefined();
    expect(created.utcEnd).toBeUndefined();
    expect(created.iCalendar).toBeUndefined();

    const call = vi.fn().mockResolvedValue({ created: { invitation: { id: "imported" } } });
    const client = { calendarAccountId: "account", call } as unknown as JmapClient;
    await expect(importCalendarInvitation(client, parsed, "personal", identities, "accepted")).resolves.toBe("imported");
    expect(call.mock.calls[0][2].create.invitation.method).toBeUndefined();
    expect(call.mock.calls[0][2].sendSchedulingMessages).toBe(true);
  });

  it("matches attendees from mail identities when ParticipantIdentity is missing", () => {
    const invite: CalendarEvent = {
      ...event,
      participants: { guest: { calendarAddress: "mailto:ada@example.test", participationStatus: "needs-action" } },
    };
    expect(findOwnParticipant(invite, [])).toBeNull();
    expect(findOwnParticipant(invite, [], ["ada@example.test"])?.id).toBe("guest");
    expect(participationStatus(invite, [], ["ADA@example.test"])).toBe("needs-action");
  });

  it("adds the local attendee only when the invitation omitted them", () => {
    const invite: CalendarEvent = { ...event, participants: { organizer: { calendarAddress: "mailto:google@example.test", roles: { chair: true } } } };
    const withAttendee = withOwnAttendee(invite, identities, ["ada@example.test"]);
    expect(findOwnParticipant(withAttendee, identities)?.participant.calendarAddress).toBe("mailto:ada@example.test");
    expect(withOwnAttendee(event, identities)).toBe(event);
  });

  it("ignores calendar query hits whose uid does not match", async () => {
    const request = vi.fn().mockResolvedValue({
      methodResponses: [
        ["CalendarEvent/query", { ids: ["other"] }, "query"],
        ["CalendarEvent/get", { list: [{ id: "other", uid: "someone-else", title: "Other" }] }, "get"],
      ],
    });
    const client = { calendarAccountId: "account", request } as unknown as JmapClient;
    await expect(findEventByUid(client, "uid-1")).resolves.toBeNull();
  });

  it("updates an existing uid instead of failing create when accepting", async () => {
    const call = vi.fn().mockResolvedValue({
      notCreated: { invitation: { type: "invalidProperties", description: "UID already exists" } },
      updated: { existing: null },
    });
    const request = vi.fn().mockResolvedValue({
      methodResponses: [
        ["CalendarEvent/query", { ids: ["existing"] }, "query"],
        ["CalendarEvent/get", { list: [{ id: "existing", uid: "uid-1", calendarIds: {}, participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "needs-action" } } }] }, "get"],
      ],
    });
    const client = { calendarAccountId: "account", call, request } as unknown as JmapClient;
    await expect(importCalendarInvitation(client, { ...event, uid: "uid-1" }, "personal", identities, "accepted", ["ada@example.test"])).resolves.toBe("existing");
    const update = call.mock.calls.find((entry) => entry[1] === "CalendarEvent/set" && entry[2].update);
    expect(update?.[2].sendSchedulingMessages).toBe(true);
    expect(update?.[2].update.existing.calendarIds).toEqual({ personal: true });
    expect(update?.[2].update.existing.participants.ada.participationStatus).toBe("accepted");
  });
});
