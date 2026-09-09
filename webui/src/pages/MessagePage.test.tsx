import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../app-context";
import type { JmapClient } from "../jmap/client";
import { Router } from "../router";
import { MessagePage } from "./MessagePage";

vi.mock("../app-context", () => ({ useApp: vi.fn() }));

const mockedUseApp = vi.mocked(useApp);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("message attachments", () => {
  it("offers a zip download when a message has more than two attachments", async () => {
    const call = vi.fn().mockResolvedValue({
      list: [{
        id: "mail-pack",
        mailboxIds: { inbox: true },
        keywords: { $seen: true },
        receivedAt: "2026-08-20T12:00:00Z",
        from: [{ name: "Theo" }],
        subject: "Packet",
        preview: "Three files",
        attachments: [
          { blobId: "a", name: "one.txt", size: 12, type: "text/plain" },
          { blobId: "b", name: "two.txt", size: 12, type: "text/plain" },
          { blobId: "c", name: "three.txt", size: 12, type: "text/plain" },
        ],
        textBody: [{ partId: "text" }],
        bodyValues: { text: { value: "Three files" } },
      }],
    });
    mockedUseApp.mockReturnValue({
      client: {
        mailAccountId: "account",
        call,
        downloadUrl: (_account: string, blobId: string) => `http://127.0.0.1:4181/download/${blobId}`,
        authorizationHeader: () => "Bearer demo",
      } as unknown as JmapClient,
      mailboxes: [
        { id: "inbox", name: "Inbox", role: "inbox" },
        { id: "trash", name: "Trash", role: "trash" },
        { id: "projects", name: "Projects" },
      ],
      notify: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => ({ arrayBuffer: async () => new TextEncoder().encode("file").buffer }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<Router><MessagePage emailId="mail-pack" /></Router>);
    expect(await screen.findByRole("button", { name: "Download all as ZIP" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download all as ZIP" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
  });
});
