import { afterEach, describe, expect, it } from "vitest";
import { clearStoredAuth, loadStoredAuth, saveStoredAuth } from "./session";

describe("stored session", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("round-trips basic credentials and clears them on logout", () => {
    saveStoredAuth({ type: "basic", server: "https://mail.example.test", username: "ada@example.test", password: "secret" });
    expect(loadStoredAuth()).toEqual({
      type: "basic",
      server: "https://mail.example.test",
      username: "ada@example.test",
      password: "secret",
    });
    expect(sessionStorage.getItem("stalwart.username")).toBe("ada@example.test");
    clearStoredAuth();
    expect(loadStoredAuth()).toBeNull();
    expect(sessionStorage.getItem("stalwart.username")).toBeNull();
  });

  it("round-trips OAuth tokens", () => {
    saveStoredAuth({
      type: "oauth",
      server: "https://mail.example.test",
      username: "ada@example.test",
      accessToken: "access",
      refreshToken: "refresh",
      tokenEndpoint: "https://mail.example.test/oauth/token",
      clientId: "webui",
    });
    expect(loadStoredAuth()).toMatchObject({ type: "oauth", accessToken: "access", refreshToken: "refresh" });
  });

  it("rejects incomplete stored auth", () => {
    localStorage.setItem("stalwart.auth", JSON.stringify({ type: "basic", server: "https://mail.example.test", username: "ada" }));
    expect(loadStoredAuth()).toBeNull();
  });
});
