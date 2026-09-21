import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../app-context";
import type { JmapClient } from "../jmap/client";
import { Router } from "../router";
import { ComposePage } from "./ComposePage";

vi.mock("../app-context", () => ({ useApp: vi.fn() }));

const mockedUseApp = vi.mocked(useApp);

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function composeApp(client: Partial<JmapClient>, notify = vi.fn()) {
  mockedUseApp.mockReturnValue({
    client: client as JmapClient,
    mailboxes: [
      { id: "drafts", name: "Drafts", role: "drafts" },
      { id: "sent", name: "Sent", role: "sent" },
    ],
    identities: [{ id: "identity", name: "Ada Rivera", email: "ada@example.test" }],
    notify,
  } as unknown as ReturnType<typeof useApp>);
  return notify;
}

describe("compose page", () => {
  it("shows the formatting toolbar and compose action toolbar", () => {
    mockedUseApp.mockReturnValue({
      client: { mailAccountId: "account" } as unknown as JmapClient,
      mailboxes: [
        { id: "drafts", name: "Drafts", role: "drafts" },
        { id: "sent", name: "Sent", role: "sent" },
      ],
      identities: [{ id: "identity", name: "Ada Rivera", email: "ada@example.test" }],
      notify: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);

    render(<Router><ComposePage /></Router>);
    expect(screen.getByLabelText("Text formatting")).toBeInTheDocument();
    expect(screen.getByLabelText("Font")).toBeInTheDocument();
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Text color")).toBeInTheDocument();
    expect(screen.getByLabelText("Align left")).toBeInTheDocument();
    expect(screen.getByLabelText("Bulleted list")).toBeInTheDocument();
    expect(screen.getByLabelText("Increase indent")).toBeInTheDocument();
    expect(screen.getByLabelText("Compose actions")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Send" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Save draft" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pictures" })).toBeInTheDocument();
  });

  it("saves a new message and a reply when Save draft is clicked", async () => {
    const upload = vi.fn().mockResolvedValue({ blobId: "blob-1" });
    const call = vi.fn().mockImplementation(async (_capability: unknown, method: string) => {
      if (method === "Email/import") return { created: { draft: { id: "draft-9" } } };
      return {};
    });
    const notify = composeApp({ mailAccountId: "account", upload, call } as unknown as Partial<JmapClient>);
    const view = render(<Router><ComposePage /></Router>);

    fireEvent.change(screen.getByPlaceholderText("name@example.com"), { target: { value: "bob@example.test" } });
    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);

    await waitFor(() => expect(call).toHaveBeenCalledWith(
      expect.anything(),
      "Email/import",
      expect.objectContaining({ emails: expect.objectContaining({ draft: expect.objectContaining({ mailboxIds: { drafts: true }, keywords: { $draft: true, $seen: true } }) }) }),
    ));
    expect(upload).toHaveBeenCalledTimes(1);
    const saved = await readBlob(upload.mock.calls[0][1]);
    expect(saved).toContain("bob@example.test");
    expect(saved).toContain("Hello");
    expect(notify).toHaveBeenCalledWith("Draft saved", "success");
    expect(window.location.pathname).toBe("/mail/compose/draft-9");

    view.unmount();
    window.history.replaceState({
      replyTo: {
        id: "msg-1",
        mailboxIds: { inbox: true },
        keywords: {},
        receivedAt: "2026-08-20T12:00:00Z",
        from: [{ name: "Bob", email: "bob@example.test" }],
        subject: "Hello",
        preview: "Hi there",
        textBody: [{ partId: "text" }],
        bodyValues: { text: { value: "Hi there" } },
      },
    }, "", "/mail/compose");
    upload.mockClear();
    call.mockClear();
    notify.mockClear();
    render(<Router><ComposePage /></Router>);
    expect(screen.getByText("REPLY")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save draft" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const reply = await readBlob(upload.mock.calls[0][1]);
    expect(reply).toContain("bob@example.test");
    expect(reply).toContain("Re: Hello");
    expect(notify).toHaveBeenCalledWith("Draft saved", "success");
  });

  it("opens a stored draft in editable fields and saves the changes over that draft", async () => {
    const upload = vi.fn().mockResolvedValue({ blobId: "blob-2" });
    const call = vi.fn().mockImplementation(async (_capability: unknown, method: string) => {
      if (method === "Email/get") {
        return {
          list: [{
            id: "draft-1",
            mailboxIds: { drafts: true },
            keywords: { $draft: true, $seen: true },
            to: [{ email: "ada@example.test" }],
            subject: "Quarterly note",
            preview: "Body text",
            receivedAt: "2026-08-20T12:00:00Z",
            textBody: [{ partId: "text" }],
            bodyValues: { text: { value: "Body text" } },
          }],
        };
      }
      if (method === "Email/import") return { created: { draft: { id: "draft-2" } } };
      return {};
    });
    composeApp({ mailAccountId: "account", upload, call } as unknown as Partial<JmapClient>);
    render(<Router><ComposePage draftId="draft-1" /></Router>);

    const subject = await screen.findByDisplayValue("Quarterly note");
    expect(screen.getByDisplayValue("ada@example.test")).toBeInTheDocument();
    expect(screen.getByLabelText("Message body")).toHaveTextContent("Body text");
    fireEvent.change(subject, { target: { value: "Updated note" } });
    expect(subject).toHaveValue("Updated note");
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const saved = await readBlob(upload.mock.calls[0][1]);
    expect(saved).toContain("Updated note");
    expect(saved).toContain("ada@example.test");
    await waitFor(() => expect(call).toHaveBeenCalledWith(
      expect.anything(),
      "Email/set",
      expect.objectContaining({ destroy: ["draft-1"] }),
    ));
  });
});
