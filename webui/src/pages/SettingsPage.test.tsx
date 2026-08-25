import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../app-context";
import { CAPABILITIES } from "../types";
import type { JmapClient } from "../jmap/client";
import { Router } from "../router";
import { SettingsPage } from "./SettingsPage";

vi.mock("../app-context", () => ({ useApp: vi.fn() }));

const mockedUseApp = vi.mocked(useApp);

afterEach(() => {
  cleanup();
});

describe("settings password", () => {
  it("changes the account password and keeps the signed-in session", async () => {
    const call = vi.fn().mockResolvedValue({ updated: { singleton: null } });
    const rememberPassword = vi.fn();
    const notify = vi.fn();
    mockedUseApp.mockReturnValue({
      client: { mailAccountId: "account", call, has: (id: string) => id === CAPABILITIES.stalwart, session: { state: "s" } } as unknown as JmapClient,
      identities: [],
      username: "ada@example.test",
      serverOrigin: "https://mail.example.test",
      online: true,
      lastSync: null,
      refresh: vi.fn(),
      logout: vi.fn(),
      rememberPassword,
      notify,
    } as unknown as ReturnType<typeof useApp>);

    render(<Router><SettingsPage /></Router>);
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-secret-1" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-secret-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-secret-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith("urn:stalwart:jmap", "x:AccountPassword/set", expect.objectContaining({
      update: { singleton: { currentSecret: "old-secret-1", secret: "new-secret-1" } },
    })));
    expect(rememberPassword).toHaveBeenCalledWith("new-secret-1");
    expect(notify).toHaveBeenCalledWith("Password updated", "success");
  });

  it("does not submit when the new passwords do not match", async () => {
    const call = vi.fn();
    const notify = vi.fn();
    mockedUseApp.mockReturnValue({
      client: { mailAccountId: "account", call, has: (id: string) => id === CAPABILITIES.stalwart, session: { state: "s" } } as unknown as JmapClient,
      identities: [],
      username: "ada@example.test",
      serverOrigin: "https://mail.example.test",
      online: true,
      lastSync: null,
      refresh: vi.fn(),
      logout: vi.fn(),
      rememberPassword: vi.fn(),
      notify,
    } as unknown as ReturnType<typeof useApp>);

    render(<Router><SettingsPage /></Router>);
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-secret-1" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-secret-1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-secret-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("The new passwords do not match.", "error"));
    expect(call).not.toHaveBeenCalled();
  });

  it("lets the user edit a signature with the formatting toolbar and picture control", () => {
    mockedUseApp.mockReturnValue({
      client: { mailAccountId: "account", call: vi.fn(), has: () => false, session: { state: "s" } } as unknown as JmapClient,
      identities: [{ id: "identity", name: "Ada Rivera", email: "ada@example.test", textSignature: "Ada Rivera", htmlSignature: "<p>Ada Rivera</p>" }],
      username: "ada@example.test",
      serverOrigin: "https://mail.example.test",
      online: true,
      lastSync: null,
      refresh: vi.fn(),
      logout: vi.fn(),
      rememberPassword: vi.fn(),
      notify: vi.fn(),
    } as unknown as ReturnType<typeof useApp>);

    render(<Router><SettingsPage /></Router>);
    expect(screen.getByLabelText("Email signature")).toBeInTheDocument();
    expect(screen.getByLabelText("Text formatting")).toBeInTheDocument();
    expect(screen.getByLabelText("Insert picture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save signature" })).toBeInTheDocument();
  });
});
