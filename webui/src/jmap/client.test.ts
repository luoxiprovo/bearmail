import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSession, retargetSession } from "./client";
import type { JmapSession } from "../types";

const session = (apiUrl: string): JmapSession => ({
  capabilities: { "urn:ietf:params:jmap:websocket": { url: "wss://127.0.0.1/jmap/ws", supportsPush: true } },
  accounts: { a: { name: "Ada", isPersonal: true, isReadOnly: false, accountCapabilities: {} } },
  primaryAccounts: { "urn:ietf:params:jmap:mail": "a" },
  username: "ada@example.test",
  apiUrl,
  downloadUrl: "https://127.0.0.1/jmap/download/{accountId}/{blobId}/{name}",
  uploadUrl: "https://127.0.0.1/jmap/upload/{accountId}/",
  eventSourceUrl: "https://127.0.0.1/jmap/eventsource/?types={types}",
  state: "1",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("JMAP session URLs", () => {
  it("keeps template placeholders when retargeting a loopback session", () => {
    const retargeted = retargetSession(session("https://127.0.0.1/jmap/"), "https://203.0.113.10");
    expect(retargeted.apiUrl).toBe("https://203.0.113.10/jmap/");
    expect(retargeted.downloadUrl).toBe("https://203.0.113.10/jmap/download/{accountId}/{blobId}/{name}");
    expect(retargeted.uploadUrl).toBe("https://203.0.113.10/jmap/upload/{accountId}/");
    expect(retargeted.eventSourceUrl).toBe("https://203.0.113.10/jmap/eventsource/?types={types}");
    expect(retargeted.capabilities["urn:ietf:params:jmap:websocket"]).toMatchObject({ url: "wss://203.0.113.10/jmap/ws" });
  });

  it("leaves a public API host on the address the server advertised", () => {
    const original = session("https://mail.example.test/jmap/");
    original.downloadUrl = "https://mail.example.test/jmap/download/{accountId}/{blobId}/{name}";
    original.uploadUrl = "https://mail.example.test/jmap/upload/{accountId}/";
    original.eventSourceUrl = "https://mail.example.test/jmap/eventsource/";
    const retargeted = retargetSession(original, "https://203.0.113.10");
    expect(retargeted.apiUrl).toBe("https://mail.example.test/jmap/");
  });

  it("requests the session resource directly and keeps the Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      url: "https://mail.example.test/jmap/session",
      json: async () => session("https://mail.example.test/jmap/"),
    });
    vi.stubGlobal("fetch", fetchMock);
    await discoverSession("https://mail.example.test", { header: () => "Basic abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://mail.example.test/jmap/session");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Basic abc");
  });

  it("uses well-known discovery only when the session URL is missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 404, ok: false, url: "https://mail.example.test/jmap/session" })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        url: "https://mail.example.test/.well-known/jmap",
        json: async () => session("https://mail.example.test/jmap/"),
      });
    vi.stubGlobal("fetch", fetchMock);
    const discovered = await discoverSession("https://mail.example.test", { header: () => "Basic abc" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://mail.example.test/.well-known/jmap");
    expect(discovered.session.accounts).toHaveProperty("a");
  });

  it("rewrites loopback URLs returned by discovery to the host the browser reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      url: "https://203.0.113.10/jmap/session",
      json: async () => session("https://127.0.0.1/jmap/"),
    }));
    const discovered = await discoverSession("https://203.0.113.10", { header: () => "Basic eA==" });
    expect(discovered.session.apiUrl).toBe("https://203.0.113.10/jmap/");
    expect(discovered.session.downloadUrl).toContain("{accountId}");
  });
});
