import { describe, expect, it, vi } from "vitest";
import { createCalendarEvent, eventEnd, eventGuestAddresses, eventSchedulingFields, findOwnParticipant, isEventOrganizer, parseGuestAddresses, participationStatus, toJmapLocal } from "./calendar";
import type { JmapClient } from "./client";
import type { CalendarEvent, ParticipantIdentity } from "../types";

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
});
