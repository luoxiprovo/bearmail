import { describe, expect, it } from "vitest";
import { isExternalRsvpHref, sanitizeEmailHtml } from "./emailHtml";

describe("email HTML sanitizer", () => {
  it("identifies Google and Outlook RSVP links without treating Meet joins as RSVP", () => {
    expect(isExternalRsvpHref("https://calendar.google.com/calendar/event?action=RESPOND&eid=abc&rst=1")).toBe(true);
    expect(isExternalRsvpHref("https://www.google.com/calendar/event?action=RESPOND&eid=abc")).toBe(true);
    expect(isExternalRsvpHref("https://outlook.office.com/calendar/0/deeplink/respond?itemid=1")).toBe(true);
    expect(isExternalRsvpHref("https://calendar.google.com/calendar/event?eid=abc")).toBe(false);
    expect(isExternalRsvpHref("https://meet.google.com/abc-defg-hij")).toBe(false);
  });

  it("removes Google RSVP buttons from invitation HTML and keeps conferencing links", () => {
    const { html } = sanitizeEmailHtml(
      `<table><tr>
        <td><a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=abc&amp;rst=1">Yes</a></td>
        <td><a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=abc&amp;rst=3">Maybe</a></td>
        <td><a href="https://calendar.google.com/calendar/event?action=RESPOND&amp;eid=abc&amp;rst=2">No</a></td>
      </tr></table>
      <p>Join <a href="https://meet.google.com/abc-defg-hij">Google Meet</a></p>`,
      { allowImages: false, stripExternalRsvp: true },
    );
    expect(html).not.toContain("action=RESPOND");
    expect(html).not.toContain(">Yes<");
    expect(html).toContain("https://meet.google.com/abc-defg-hij");
  });
});
