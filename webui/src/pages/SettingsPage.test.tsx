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
  vi.restoreAllMocks();
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
    expect(call).not.toHaveBeenCalledWith("urn:stalwart:jmap", "x:AccountPassword/set", expect.anything());
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
    expect(screen.queryByRole("button", { name: "Generate API key" })).not.toBeInTheDocument();
  });
});

describe("settings API keys", () => {
  function appWith(call: ReturnType<typeof vi.fn>, notify = vi.fn()) {
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
    return notify;
  }

  it("generates a key, shows it once, and can revoke an existing key", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const notify = vi.fn();
    const call = vi.fn(async (_capability: string, method: string, args: Record<string, unknown>) => {
      if (method === "x:ApiKey/query") return { ids: ["b"] };
      if (method === "x:ApiKey/get") return { list: [{ id: "b", description: "Laptop", createdAt: "2026-02-01T00:00:00Z" }] };
      if (method === "x:ApiKey/set" && "create" in args) return { created: { "new-key": { id: "c", secret: "API_newsecret" } } };
      if (method === "x:ApiKey/set" && "destroy" in args) return { destroyed: ["b"] };
      return {};
    });
    appWith(call, notify);

    render(<Router><SettingsPage /></Router>);
    expect(await screen.findByRole("button", { name: "Revoke Laptop" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API key name"), { target: { value: "Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate API key" }));

    const secret = await screen.findByLabelText("New API key");
    expect(secret).toHaveValue("API_newsecret");
    expect(call).toHaveBeenCalledWith("urn:stalwart:jmap", "x:ApiKey/set", {
      accountId: "account",
      create: { "new-key": { description: "Agent" } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("API_newsecret"));
    fireEvent.click(screen.getByRole("button", { name: "I have saved this key" }));
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke Laptop" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("urn:stalwart:jmap", "x:ApiKey/set", {
      accountId: "account",
      destroy: ["b"],
    }));
    expect(notify).toHaveBeenCalledWith("API key revoked", "success");
  });

  it("does not create a key when the name is blank", async () => {
    const notify = vi.fn();
    const call = vi.fn().mockResolvedValue({ ids: [] });
    appWith(call, notify);
    render(<Router><SettingsPage /></Router>);
    expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate API key" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Enter a name for this API key.", "error"));
    expect(call).not.toHaveBeenCalledWith("urn:stalwart:jmap", "x:ApiKey/set", expect.anything());
  });
});
