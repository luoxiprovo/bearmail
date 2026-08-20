import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, Clock3, MapPin, UsersRound } from "lucide-react";
import { useApp } from "../app-context";
import { findEventByUid, importCalendarInvitation, parseCalendarAttachment, participationStatus, respondToInvitation } from "../jmap/calendar";
import type { CalendarEvent, EmailBodyPart, ParticipationStatus } from "../types";

export function InvitationCard({ attachment }: { attachment: EmailBodyPart }) {
  const { client, calendars, identities, participantIdentities, username, notify, refresh } = useApp();
  const extraAddresses = useMemo(
    () => [...identities.map((item) => item.email), username].filter(Boolean),
    [identities, username],
  );
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [persisted, setPersisted] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<ParticipationStatus | "add" | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    if (!attachment.blobId) {
      setLoading(false);
      setError("This invitation has no calendar file to import.");
      return;
    }
    setLoading(true);
    setError("");
    parseCalendarAttachment(client, attachment.blobId).then(async (parsed) => {
      if (cancelled) return;
      if (!parsed) {
        setError("This invitation could not be read. Try downloading the .ics attachment.");
        return;
      }
      setEvent(parsed);
      if (parsed.uid) setPersisted(await findEventByUid(client, parsed.uid));
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "This invitation could not be read.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attachment.blobId, client]);

  const shown = persisted ?? event;
  const onCalendar = Boolean(persisted && Object.keys(persisted.calendarIds ?? {}).length);
  const ownStatus = useMemo(() => shown ? participationStatus(shown, participantIdentities, extraAddresses) : "none", [extraAddresses, shown, participantIdentities]);
  if (loading) return <div className="invitation-card loading-card">Reading calendar invitation…</div>;
  if (!client) return null;
  if (!shown) {
    return (
      <section className="invitation-card" aria-label="Calendar invitation">
        <div className="invite-content">
          <p className="eyebrow">CALENDAR INVITATION</p>
          <h2>Could not open this invitation</h2>
          <p>{error || "The calendar file could not be parsed."}</p>
        </div>
      </section>
    );
  }

  const respond = async (status: Exclude<ParticipationStatus, "needs-action">) => {
    setActing(status);
    try {
      const calendar = calendars.find((item) => item.isVisible !== false) ?? calendars[0];
      if (!calendar) throw new Error("Create a calendar before adding this invitation.");
      if (persisted) {
        await respondToInvitation(client, persisted, participantIdentities, status, extraAddresses, calendar.id);
        setPersisted({ ...persisted, calendarIds: persisted.calendarIds ?? { [calendar.id]: true }, participants: updateOwnStatus(persisted, [...participantIdentities.map((identity) => identity.calendarAddress), ...extraAddresses], status) });
      } else {
        const id = await importCalendarInvitation(client, shown, calendar.id, participantIdentities, status, extraAddresses);
        setPersisted({ ...shown, id, calendarIds: { [calendar.id]: true }, participants: updateOwnStatus(shown, [...participantIdentities.map((identity) => identity.calendarAddress), ...extraAddresses], status) });
      }
      notify(status === "accepted" ? "Invitation accepted" : status === "tentative" ? "Marked as maybe" : "Invitation declined", "success");
      await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "The invitation could not be updated.", "error"); }
    finally { setActing(null); }
  };

  const add = async () => {
    const calendar = calendars.find((item) => item.isVisible !== false) ?? calendars[0];
    if (!calendar || !client) return;
    setActing("add");
    try {
      const id = await importCalendarInvitation(client, shown, calendar.id, participantIdentities, "needs-action", extraAddresses);
      setPersisted({ ...shown, id, calendarIds: { [calendar.id]: true } });
      notify("Invitation added to your calendar", "success");
    } catch (error) { notify(error instanceof Error ? error.message : "The invitation could not be added.", "error"); }
    finally { setActing(null); }
  };

  const location = Object.values(shown.locations ?? {})[0]?.name;
  const attendees = Object.keys(shown.participants ?? {}).length;
  return (
    <section className="invitation-card" aria-label="Calendar invitation">
      <div className="invite-accent"><CalendarCheck2 size={25} /></div>
      <div className="invite-content">
        <p className="eyebrow">CALENDAR INVITATION</p><h2>{shown.title || "Untitled event"}</h2>
        <div className="invite-facts">
          <span><Clock3 size={17} /><b>{formatEventDate(shown)}</b></span>
          {location && <span><MapPin size={17} />{location}</span>}
          {attendees > 0 && <span><UsersRound size={17} />{attendees} attendee{attendees === 1 ? "" : "s"}</span>}
        </div>
        {shown.description && <p className="invite-description">{shown.description}</p>}
        <div className="invite-actions" aria-label="Respond to invitation">
          <button className={ownStatus === "accepted" ? "selected" : ""} aria-pressed={ownStatus === "accepted"} disabled={Boolean(acting)} onClick={() => void respond("accepted")}>{acting === "accepted" ? "Saving…" : onCalendar ? "Accept" : "Accept and add to calendar"}</button>
          <button className={ownStatus === "tentative" ? "selected" : ""} aria-pressed={ownStatus === "tentative"} disabled={Boolean(acting)} onClick={() => void respond("tentative")}>Maybe</button>
          <button className={ownStatus === "declined" ? "selected declined" : ""} aria-pressed={ownStatus === "declined"} disabled={Boolean(acting)} onClick={() => void respond("declined")}>Decline</button>
          {!onCalendar && <button className="text-button" disabled={Boolean(acting)} onClick={() => void add()}>{acting === "add" ? "Adding…" : "Add without responding"}</button>}
        </div>
        {onCalendar && <p className="invite-state">On your calendar · {ownStatus === "needs-action" ? "Awaiting your response" : ownStatus}</p>}
      </div>
    </section>
  );
}

function updateOwnStatus(event: CalendarEvent, addresses: string[], status: ParticipationStatus) {
  const normalized = new Set(addresses.map((item) => item.toLowerCase().replace(/^mailto:/, "")));
  return Object.fromEntries(Object.entries(event.participants ?? {}).map(([id, participant]) => {
    const address = (participant.calendarAddress ?? participant.email ?? "").toLowerCase().replace(/^mailto:/, "");
    return [id, normalized.has(address) ? { ...participant, participationStatus: status } : participant];
  }));
}

function formatEventDate(event: CalendarEvent): string {
  const date = new Date(event.start);
  if (event.showWithoutTime) return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
