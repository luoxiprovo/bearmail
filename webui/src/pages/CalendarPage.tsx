import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, LoaderCircle, MapPin, Plus, Trash2, UsersRound, X } from "lucide-react";
import { useApp } from "../app-context";
import { createCalendarEvent, destroyCalendarEvent, eventEnd, eventGuestAddresses, eventSchedulingFields, getCalendarEvents, importUnansweredInvitesFromMail, isEventOrganizer, isParticipantIdentityAddress, parseGuestAddresses, participationStatus, respondToInvitation, showsOnCalendar, toJmapLocal, updateCalendarEvent, type EventInput } from "../jmap/calendar";
import type { CalendarEvent, ParticipationStatus } from "../types";

type CalendarView = "month" | "week" | "day" | "agenda";

export function CalendarPage() {
  const { client, calendars, identities, participantIdentities, username, notify, syncVersion } = useApp();
  const [view, setView] = useState<CalendarView>(() => (localStorage.getItem("stalwart.calendarView") as CalendarView) || "month");
  const [anchor, setAnchor] = useState(startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ event?: CalendarEvent; date?: Date } | null>(null);
  const range = useMemo(() => viewRange(anchor, view), [anchor, view]);

  useEffect(() => { if (calendars.length && !visible.size) setVisible(new Set(calendars.filter((item) => item.isVisible !== false).map((item) => item.id))); }, [calendars, visible.size]);
  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const calendarId = calendars.find((item) => item.isVisible !== false)?.id ?? calendars[0]?.id;
      const extraAddresses = [...identities.map((item) => item.email), username].filter(Boolean);
      if (calendarId) await importUnansweredInvitesFromMail(client, calendarId, participantIdentities, extraAddresses);
      setEvents(await getCalendarEvents(client, range.start, range.end));
    }
    catch (error) { notify(error instanceof Error ? error.message : "Calendar could not be loaded.", "error"); }
    finally { setLoading(false); }
  }, [calendars, client, identities, notify, participantIdentities, range.end.getTime(), range.start.getTime(), syncVersion, username]);
  useEffect(() => { void load(); }, [load]);

  const filtered = events.filter((event) => Object.keys(event.calendarIds ?? {}).some((id) => visible.has(id)) && showsOnCalendar(event, participantIdentities)).map((event) => ({
    ...event,
    color: event.color || calendars.find((calendar) => event.calendarIds?.[calendar.id])?.color,
  }));
  const chooseView = (next: CalendarView) => { setView(next); localStorage.setItem("stalwart.calendarView", next); };
  const move = (direction: number) => setAnchor((date) => {
    const next = new Date(date);
    if (view === "month" || view === "agenda") next.setMonth(next.getMonth() + direction);
    else if (view === "week") next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction);
    return next;
  });
  return (
    <div className="calendar-layout">
      <aside className="calendar-sidebar">
        <button className="primary-button new-event" onClick={() => setEditor({ date: new Date() })}><Plus size={18} /> New event</button>
        <MiniMonth anchor={anchor} selected={anchor} onSelect={setAnchor} />
        <div className="calendar-list"><div className="panel-heading"><span>My calendars</span></div>{calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={visible.has(calendar.id)} onChange={() => setVisible((current) => { const next = new Set(current); next.has(calendar.id) ? next.delete(calendar.id) : next.add(calendar.id); return next; })} /><i style={{ background: calendar.color || "#287f77" }} /><span>{calendar.name}</span></label>)}</div>
        <div className="invite-legend"><p className="eyebrow">INVITATION STATUS</p><span><i className="legend-solid" /> Accepted</span><span><i className="legend-pending" /> Awaiting response</span></div>
      </aside>
      <section className="calendar-main">
        <header className="calendar-header"><div><p className="eyebrow">CALENDAR</p><h1>{rangeLabel(anchor, view)}</h1></div><div className="calendar-controls"><button className="today-button" onClick={() => setAnchor(startOfDay(new Date()))}>Today</button><button className="icon-button" aria-label="Previous" onClick={() => move(-1)}><ChevronLeft size={19} /></button><button className="icon-button" aria-label="Next" onClick={() => move(1)}><ChevronRight size={19} /></button><div className="view-switch" aria-label="Calendar view">{(["day", "week", "month", "agenda"] as CalendarView[]).map((item) => <button key={item} aria-pressed={view === item} className={view === item ? "active" : ""} onClick={() => chooseView(item)}>{item}</button>)}</div><button className="icon-button header-add" aria-label="New event" onClick={() => setEditor({ date: anchor })}><CalendarPlus size={19} /></button></div></header>
        {loading ? <div className="page-loading"><LoaderCircle className="spin" /> Loading calendar…</div> : view === "month" ? <MonthView anchor={anchor} events={filtered} identities={participantIdentities} onSelect={(event) => setEditor({ event })} onCreate={(date) => setEditor({ date })} /> : <TimelineView anchor={anchor} view={view} events={filtered} identities={participantIdentities} onSelect={(event) => setEditor({ event })} />}
      </section>
      {editor && <EventDialog event={editor.event} initialDate={editor.date} onClose={() => setEditor(null)} onChanged={async () => { setEditor(null); await load(); }} />}
    </div>
  );
}

function MonthView({ anchor, events, identities, onSelect, onCreate }: { anchor: Date; events: CalendarEvent[]; identities: ReturnType<typeof useApp>["participantIdentities"]; onSelect(event: CalendarEvent): void; onCreate(date: Date): void }) {
  const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  return <div className="month-grid"><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-days">{days.map((day) => { const dayEvents = events.filter((event) => sameDay(eventDate(event), day)); return <div key={day.toISOString()} className={`month-day ${day.getMonth() !== anchor.getMonth() ? "outside" : ""} ${sameDay(day, new Date()) ? "today" : ""}`} onDoubleClick={() => onCreate(day)}><button className="date-button" aria-label={`Create event on ${day.toDateString()}`} onClick={() => onCreate(day)}>{day.getDate()}</button><div className="day-events">{dayEvents.slice(0, 4).map((event) => <EventPill key={event.id} event={event} identities={identities} onClick={() => onSelect(event)} />)}{dayEvents.length > 4 && <button className="more-events" onClick={() => undefined}>+{dayEvents.length - 4} more</button>}</div></div>; })}</div></div>;
}

function TimelineView({ anchor, view, events, identities, onSelect }: { anchor: Date; view: CalendarView; events: CalendarEvent[]; identities: ReturnType<typeof useApp>["participantIdentities"]; onSelect(event: CalendarEvent): void }) {
  const days = view === "day" ? [anchor] : view === "week" ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)) : [];
  if (view === "agenda") return <div className="agenda-view">{events.length ? events.map((event) => <button key={event.id} className={`agenda-event status-${participationStatus(event, identities)}`} onClick={() => onSelect(event)}><time><b>{eventDate(event).toLocaleDateString([], { month: "short", day: "numeric" })}</b><span>{event.showWithoutTime ? "All day" : eventDate(event).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></time><i style={{ background: event.color || "#287f77" }} /><span><b>{event.title || "Untitled event"}</b><small>{Object.values(event.locations ?? {})[0]?.name || event.description || "No details"}</small></span></button>) : <div className="empty-state"><CalendarPlus size={38} /><h2>No events this month</h2></div>}</div>;
  return <div className={`timeline-view columns-${days.length}`}>{days.map((day) => <section key={day.toISOString()} className={sameDay(day, new Date()) ? "today" : ""}><header><span>{day.toLocaleDateString([], { weekday: "short" })}</span><b>{day.getDate()}</b></header><div>{events.filter((event) => sameDay(eventDate(event), day)).map((event) => <EventPill key={event.id} event={event} identities={identities} onClick={() => onSelect(event)} expanded />)}</div></section>)}</div>;
}

function EventPill({ event, identities, onClick, expanded = false }: { event: CalendarEvent; identities: ReturnType<typeof useApp>["participantIdentities"]; onClick(): void; expanded?: boolean }) {
  const status = participationStatus(event, identities);
  return <button className={`event-pill status-${status}`} style={{ "--event-color": event.color || "#287f77" } as React.CSSProperties} onClick={(click) => { click.stopPropagation(); onClick(); }}><span className="event-title">{event.title || "Untitled event"}</span>{(expanded || !event.showWithoutTime) && <time>{event.showWithoutTime ? "All day" : eventDate(event).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>}<span className="sr-only">{status === "needs-action" ? "Awaiting response" : status}</span></button>;
}

function EventDialog({ event, initialDate, onClose, onChanged }: { event?: CalendarEvent; initialDate?: Date; onClose(): void; onChanged(): Promise<void> }) {
  const { client, calendars, identities, participantIdentities, username, notify } = useApp();
  const initialStart = event ? eventDate(event) : withHour(initialDate ?? new Date(), new Date().getHours() + 1);
  const initialEnd = event ? eventEnd(event) : new Date(initialStart.getTime() + 3_600_000);
  const [input, setInput] = useState<EventInput>({ title: event?.title ?? "", start: toInputValue(initialStart, event?.showWithoutTime), end: toInputValue(initialEnd, event?.showWithoutTime), allDay: event?.showWithoutTime ?? false, calendarId: Object.keys(event?.calendarIds ?? {})[0] ?? calendars[0]?.id ?? "", description: event?.description ?? "", location: Object.values(event?.locations ?? {})[0]?.name ?? "" });
  const [guestText, setGuestText] = useState(() => event ? eventGuestAddresses(event, participantIdentities).join(", ") : "");
  const [guestError, setGuestError] = useState("");
  const [busy, setBusy] = useState(false);
  const ownStatus = event ? participationStatus(event, participantIdentities) : "none";
  const canManageGuests = !event || isEventOrganizer(event, participantIdentities);
  const guestCount = canManageGuests
    ? parseGuestAddresses(guestText).addresses.filter((address) => !isParticipantIdentityAddress(address, participantIdentities)).length
    : 0;
  const update = (field: Exclude<keyof EventInput, "guestAddresses">, value: string | boolean) => setInput((current) => ({ ...current, [field]: value }));
  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!client) return;
    const parsedGuests = parseGuestAddresses(guestText);
    if (canManageGuests && parsedGuests.invalid.length) {
      setGuestError(`Check ${parsedGuests.invalid.length === 1 ? "this address" : "these addresses"}: ${parsedGuests.invalid.join(", ")}`);
      return;
    }
    const ownGuestAddresses = parsedGuests.addresses.filter((address) => isParticipantIdentityAddress(address, participantIdentities));
    if (canManageGuests && ownGuestAddresses.length) {
      setGuestError(`You are already the organizer. Remove ${ownGuestAddresses.join(", ")} from Guests.`);
      return;
    }
    const guestAddresses = canManageGuests
      ? parsedGuests.addresses
      : [];
    if (guestAddresses.length && !participantIdentities.length) {
      setGuestError("This account has no calendar identity to send invitations from.");
      return;
    }
    setGuestError("");
    setBusy(true);
    try {
      if (event) {
        const patch = eventPatch(input);
        if (canManageGuests) {
          const scheduling = eventSchedulingFields(participantIdentities, guestAddresses, event);
          if (scheduling) Object.assign(patch, scheduling);
        }
        await updateCalendarEvent(client, event.id, patch, true);
      } else {
        await createCalendarEvent(client, { ...input, guestAddresses }, participantIdentities);
      }
      notify(guestAddresses.length ? (event ? "Event updated and guests notified" : "Event created and invitations sent") : (event ? "Event updated" : "Event created"), "success");
      await onChanged();
    } catch (error) { notify(error instanceof Error ? error.message : "Event could not be saved.", "error"); setBusy(false); }
  };
  const respond = async (status: Exclude<ParticipationStatus, "needs-action">) => {
    if (!client || !event) return; setBusy(true);
    try {
      await respondToInvitation(client, event, participantIdentities, status, [...identities.map((item) => item.email), username].filter(Boolean));
      notify(status === "accepted" ? "Invitation accepted" : status === "tentative" ? "Marked as maybe" : "Invitation declined", "success");
      await onChanged();
    }
    catch (error) { notify(error instanceof Error ? error.message : "Response could not be sent.", "error"); setBusy(false); }
  };
  const remove = async () => { if (!client || !event || !confirm("Delete this event? Attendees may receive a cancellation.")) return; setBusy(true); try { await destroyCalendarEvent(client, event.id); notify("Event deleted", "success"); await onChanged(); } catch (error) { notify(error instanceof Error ? error.message : "Event could not be deleted.", "error"); setBusy(false); } };
  return (
    <div className="dialog-backdrop" onMouseDown={(click) => { if (click.target === click.currentTarget) onClose(); }}>
      <form className="event-dialog" onSubmit={submit} aria-modal="true" role="dialog" aria-labelledby="event-title">
        <header>
          <div><p className="eyebrow">{event ? (ownStatus === "needs-action" ? "INVITATION" : "EVENT DETAILS") : "NEW EVENT"}</p><h2 id="event-title">{event?.title || "Plan your time"}</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </header>
        {event && !canManageGuests && ownStatus !== "none" && (
          <div className="dialog-rsvp">
            <span>{ownStatus === "needs-action" ? "Awaiting your response" : "Your response"}</span>
            {(["accepted", "tentative", "declined"] as const).map((status) => (
              <button type="button" key={status} aria-pressed={ownStatus === status} className={ownStatus === status ? "selected" : ""} disabled={busy} onClick={() => void respond(status)}>
                {status === "accepted" ? "Accept" : status === "tentative" ? "Maybe" : "Decline"}
              </button>
            ))}
          </div>
        )}
        <label>Title<input autoFocus required value={input.title} onChange={(change) => update("title", change.target.value)} placeholder="Event title" /></label>
        <div className="event-time-row">
          <label><Clock3 size={16} /> Starts<input type={input.allDay ? "date" : "datetime-local"} required value={input.start} onChange={(change) => update("start", change.target.value)} /></label>
          <label>Ends<input type={input.allDay ? "date" : "datetime-local"} required value={input.end} onChange={(change) => update("end", change.target.value)} /></label>
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={input.allDay} onChange={(change) => update("allDay", change.target.checked)} /> All-day event</label>
        <label>Calendar<select value={input.calendarId} onChange={(change) => update("calendarId", change.target.value)}>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
        <label><MapPin size={16} /> Location<input value={input.location} onChange={(change) => update("location", change.target.value)} placeholder="Optional" /></label>
        {canManageGuests ? (
          <label className="guest-field">
            <span><UsersRound size={16} /> Guests</span>
            <textarea
              value={guestText}
              onChange={(change) => { setGuestText(change.target.value); setGuestError(""); }}
              placeholder="guest@example.com, another@example.com"
              aria-label="Guests"
              aria-describedby={guestError ? "guest-help guest-error" : "guest-help"}
              aria-invalid={guestError ? "true" : undefined}
            />
            <small id="guest-help">Separate email addresses with commas, semicolons, or line breaks. Invitations are emailed when you save.</small>
            {guestError && <small id="guest-error" className="field-error" role="alert">{guestError}</small>}
          </label>
        ) : event?.participants ? (
          <div className="dialog-attendees"><UsersRound size={17} /><span>{Object.keys(event.participants).length} attendee{Object.keys(event.participants).length === 1 ? "" : "s"}</span></div>
        ) : null}
        <label>Notes<textarea value={input.description} onChange={(change) => update("description", change.target.value)} placeholder="Add details" /></label>
        <footer>
          {event && <button type="button" className="danger-button" onClick={() => void remove()}><Trash2 size={16} /> Delete</button>}
          <span />
          <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy}><Check size={16} /> {busy ? (guestCount ? "Sending…" : "Saving…") : guestCount ? (event ? "Save & notify" : "Save & send") : "Save event"}</button>
        </footer>
      </form>
    </div>
  );
}

function MiniMonth({ anchor, selected, onSelect }: { anchor: Date; selected: Date; onSelect(date: Date): void }) { const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)); return <div className="mini-month"><strong>{anchor.toLocaleDateString([], { month: "long", year: "numeric" })}</strong><div className="mini-weekdays">{"SMTWTFS".split("").map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="mini-days">{Array.from({ length: 42 }, (_, index) => addDays(start, index)).map((date) => <button key={date.toISOString()} className={`${date.getMonth() !== anchor.getMonth() ? "outside" : ""} ${sameDay(date, selected) ? "selected" : ""} ${sameDay(date, new Date()) ? "today" : ""}`} onClick={() => onSelect(date)}>{date.getDate()}</button>)}</div></div>; }

function eventPatch(input: EventInput): Record<string, unknown> { const start = new Date(input.start); const end = new Date(input.end); return { title: input.title, start: input.allDay ? input.start.slice(0, 10) : toJmapLocal(start), duration: isoDuration(Math.max(60_000, end.getTime() - start.getTime())), showWithoutTime: input.allDay, calendarIds: { [input.calendarId]: true }, timeZone: input.allDay ? null : Intl.DateTimeFormat().resolvedOptions().timeZone, description: input.description || null, locations: input.location ? { location: { "@type": "Location", name: input.location } } : null }; }
function isoDuration(milliseconds: number): string { const minutes = Math.round(milliseconds / 60_000); const days = Math.floor(minutes / 1440); const hours = Math.floor((minutes % 1440) / 60); const mins = minutes % 60; return days && !hours && !mins ? `P${days}D` : `P${days ? `${days}D` : ""}T${hours ? `${hours}H` : ""}${mins ? `${mins}M` : ""}`; }
function eventDate(event: CalendarEvent): Date { return new Date(event.start.length === 10 ? `${event.start}T00:00:00` : event.start); }
function startOfDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfWeek(date: Date): Date { const next = startOfDay(date); next.setDate(next.getDate() - next.getDay()); return next; }
function addDays(date: Date, amount: number): Date { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function sameDay(left: Date, right: Date): boolean { return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate(); }
function withHour(date: Date, hour: number): Date { const next = new Date(date); next.setHours(Math.min(hour, 23), 0, 0, 0); return next; }
function toInputValue(date: Date, allDay = false): string { const pad = (value: number) => String(value).padStart(2, "0"); const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; return allDay ? base : `${base}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function viewRange(anchor: Date, view: CalendarView) { if (view === "day") return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) }; if (view === "week") { const start = startOfWeek(anchor); return { start, end: addDays(start, 7) }; } const start = view === "month" ? startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : new Date(anchor.getFullYear(), anchor.getMonth(), 1); return { start, end: view === "month" ? addDays(start, 42) : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) }; }
function rangeLabel(anchor: Date, view: CalendarView): string { if (view === "day") return anchor.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }); if (view === "week") { const end = addDays(startOfWeek(anchor), 6); return `${startOfWeek(anchor).toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`; } return anchor.toLocaleDateString([], { month: "long", year: "numeric" }); }
