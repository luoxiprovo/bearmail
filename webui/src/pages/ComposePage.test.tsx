import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApp } from "../app-context";
import type { JmapClient } from "../jmap/client";
import { Router } from "../router";
import { ComposePage } from "./ComposePage";

vi.mock("../app-context", () => ({ useApp: vi.fn() }));

const mockedUseApp = vi.mocked(useApp);

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
    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pictures" })).toBeInTheDocument();
  });
});
