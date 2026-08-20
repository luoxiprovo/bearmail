import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../app-context";
import type { JmapClient } from "../jmap/client";
import { CalendarPage } from "./CalendarPage";

vi.mock("../app-context", () => ({ useApp: vi.fn() }));

const mockedUseApp = vi.mocked(useApp);

describe("calendar event dialog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("validates guest email and sends a scheduled event", async () => {
    const request = vi.fn().mockResolvedValue({
      methodResponses: [["CalendarEvent/get", { accountId: "account", state: "events", list: [] }, "get"]],
    });
    const call = vi.fn().mockResolvedValue({ created: { event: { id: "created-event" } } });
    const notify = vi.fn();
    const client = { calendarAccountId: "account", request, call, has: () => false } as unknown as JmapClient;
    mockedUseApp.mockReturnValue({
      client,
      calendars: [{ id: "calendar", name: "Personal" }],
      identities: [{ id: "ada", email: "ada@example.test" }],
      username: "ada@example.test",
      participantIdentities: [{ id: "ada", name: "Ada", calendarAddress: "mailto:ada@example.test", isDefault: true }],
      notify,
      syncVersion: 0,
    } as unknown as ReturnType<typeof useApp>);

    render(<CalendarPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "New event" })[0]);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Planning" } });
    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "not-an-address" } });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not-an-address");
    expect(call).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & send" }));

    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    const payload = call.mock.calls[0][2];
    expect(payload.sendSchedulingMessages).toBe(true);
    expect(payload.create.event.organizerCalendarAddress).toBe("mailto:ada@example.test");
    expect(Object.values(payload.create.event.participants)).toContainEqual(expect.objectContaining({
      calendarAddress: "mailto:guest@example.test",
      participationStatus: "needs-action",
    }));
    expect(notify).toHaveBeenCalledWith("Event created and invitations sent", "success");
  });

  it("shows unanswered invitations faintly, lets the user RSVP, and hides declined events", async () => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T10:00:00`;
    const request = vi.fn().mockResolvedValue({
      methodResponses: [["CalendarEvent/get", {
        accountId: "account",
        state: "events",
        list: [
          {
            id: "pending",
            title: "Pending invite",
            start,
            duration: "PT1H",
            calendarIds: { calendar: true },
            participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "needs-action" } },
          },
          {
            id: "accepted",
            title: "Accepted meeting",
            start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T14:00:00`,
            duration: "PT1H",
            calendarIds: { calendar: true },
            participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "accepted" } },
          },
          {
            id: "declined",
            title: "Declined meeting",
            start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T16:00:00`,
            duration: "PT1H",
            calendarIds: { calendar: true },
            participants: { ada: { calendarAddress: "mailto:ada@example.test", participationStatus: "declined" } },
          },
        ],
      }, "get"]],
    });
    const call = vi.fn().mockResolvedValue({});
    mockedUseApp.mockReturnValue({
      client: { calendarAccountId: "account", request, call, has: () => false } as unknown as JmapClient,
      calendars: [{ id: "calendar", name: "Personal" }],
      identities: [{ id: "ada", email: "ada@example.test" }],
      username: "ada@example.test",
      participantIdentities: [{ id: "ada", name: "Ada", calendarAddress: "mailto:ada@example.test", isDefault: true }],
      notify: vi.fn(),
      syncVersion: 0,
    } as unknown as ReturnType<typeof useApp>);

    render(<CalendarPage />);

    expect(await screen.findByText("Pending invite")).toBeInTheDocument();
    expect(screen.getByText("Pending invite").closest("button")).toHaveClass("status-needs-action");
    expect(screen.getByText("Accepted meeting").closest("button")).toHaveClass("status-accepted");
    expect(screen.queryByText("Declined meeting")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Pending invite"));
    expect(await screen.findByText("Awaiting your response")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });
});
