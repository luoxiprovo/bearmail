import { describe, expect, it } from "vitest";
import { normalizeServerUrl, resolveTemplateUrl } from "./config";

describe("connection configuration", () => {
  it("normalizes hostnames to HTTPS", () => {
    expect(normalizeServerUrl("mail.example.test/")).toBe("https://mail.example.test");
    expect(normalizeServerUrl("https://mail.example.test/some/path?ignored=true")).toBe("https://mail.example.test");
  });

  it("allows HTTP only for local development", () => {
    expect(normalizeServerUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(() => normalizeServerUrl("http://mail.example.test")).toThrow("HTTPS");
  });

  it("rejects credentials in URLs", () => {
    expect(() => normalizeServerUrl("https://user:secret@example.test")).toThrow("credentials");
  });

  it("resolves and escapes JMAP URL templates", () => {
    expect(resolveTemplateUrl("/download/{accountId}/{blobId}/{name}", {
      accountId: "a/1", blobId: "b+2", name: "agenda.ics",
    })).toBe("/download/a%2F1/b%2B2/agenda.ics");
  });
});
