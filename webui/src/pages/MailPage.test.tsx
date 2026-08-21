import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApp } from "../app-context";
import type { JmapClient } from "../jmap/client";
import { Router } from "../router";
import { MailPage } from "./MailPage";

vi.mock("../app-context", () => ({ useApp: vi.fn() }));

const mockedUseApp = vi.mocked(useApp);

describe("mail list", () => {
  it("shows unread counts and marks selected messages read or unread", async () => {
    const request = vi.fn().mockResolvedValue({
      methodResponses: [
        ["Email/query", { ids: ["mail-1", "mail-2"], total: 2, queryState: "q" }, "query"],
        ["Email/get", { list: [
          { id: "mail-1", mailboxIds: { inbox: true }, keywords: {}, receivedAt: "2026-08-20T12:00:00Z", from: [{ name: "Bob" }], subject: "Unread note", preview: "Hello" },
          { id: "mail-2", mailboxIds: { inbox: true }, keywords: { $seen: true }, receivedAt: "2026-08-20T11:00:00Z", from: [{ name: "Cara" }], subject: "Read note", preview: "Hi" },
        ] }, "get"],
      ],
    });
    const call = vi.fn().mockResolvedValue({ updated: { "mail-1": null } });
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockedUseApp.mockReturnValue({
      client: { mailAccountId: "account", request, call } as unknown as JmapClient,
      mailboxes: [{ id: "inbox", name: "Inbox", role: "inbox", unreadEmails: 3, totalEmails: 10 }],
      notify: vi.fn(),
      refresh,
      syncVersion: 0,
    } as unknown as ReturnType<typeof useApp>);

    render(<Router><MailPage /></Router>);

    expect(await screen.findByText("Unread note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inbox/ })).toHaveTextContent("3");
    expect(screen.getByText(/2 conversations/)).toHaveTextContent("3 unread");

    fireEvent.click(screen.getByLabelText("Select Unread note"));
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("urn:ietf:params:jmap:mail", "Email/set", expect.objectContaining({
      update: { "mail-1": { "keywords/$seen": true } },
    })));
    expect(refresh).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Select Read note"));
    fireEvent.click(screen.getByRole("button", { name: "Mark unread" }));

    await waitFor(() => expect(call).toHaveBeenLastCalledWith("urn:ietf:params:jmap:mail", "Email/set", expect.objectContaining({
      update: { "mail-2": { "keywords/$seen": null } },
    })));
  });
});
