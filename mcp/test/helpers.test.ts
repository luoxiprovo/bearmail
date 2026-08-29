import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { htmlToPlainText, containsActiveHtml, wrapUntrustedText } from "../src/text.js";
import { discoveryDocument } from "../src/discovery.js";
import { assertScope } from "../src/scopes.js";
import { SendQuota } from "../src/limits.js";
import { BearerAuthProvider, BasicAuthProvider, discoverSession, authFromHttpHeader, authFromHeadersOrConfig } from "../src/jmap.js";
import { ToolError } from "../src/errors.js";

describe("htmlToPlainText", () => {
  it("strips tags and scripts", () => {
    expect(htmlToPlainText("<p>Hi</p><script>alert(1)</script>")).toBe("Hi");
    expect(containsActiveHtml("<p onclick=x>Hi</p>")).toBe(true);
    expect(wrapUntrustedText("hello").untrusted_content).toBe(true);
  });
});

describe("scopes", () => {
  it("fails closed without mail.send", () => {
    expect(() => assertScope("send_email", new Set(["mail.read"]))).toThrow(/mail.send/);
  });
});

describe("send quota", () => {
  it("stops after the daily cap", () => {
    const quota = new SendQuota(1);
    quota.consume("ada@example.test");
    expect(() => quota.consume("ada@example.test")).toThrow(/cap/i);
  });
});

describe("discovery", () => {
  it("does not include tokens", () => {
    const doc = JSON.stringify(discoveryDocument("https://mail.example.com"));
    expect(doc).toContain("/.well-known/jmap");
    expect(doc).not.toContain("Bearer ey");
  });
});

describe("authFromHttpHeader", () => {
  it("rejects schemes other than Basic or Bearer", () => {
    expect(() => authFromHttpHeader("NotBearer garbage")).toThrow(ToolError);
  });

  it("rejects app passwords as Bearer", () => {
    expect(() => authFromHttpHeader("Bearer app_exampletoken")).toThrow(/API key/);
  });
});

describe("authFromHeadersOrConfig", () => {
  it("sends Stalwart API keys as Bearer without requiring a username", () => {
    const auth = authFromHeadersOrConfig(undefined, undefined, "API_examplekey", undefined);
    expect(auth).toBeInstanceOf(BearerAuthProvider);
    expect(auth.header()).toBe("Bearer API_examplekey");
  });

  it("rejects app passwords in BEARMAIL_TOKEN", () => {
    expect(() => authFromHeadersOrConfig(undefined, "east.hill@example.com", "app_exampletoken", undefined)).toThrow(/API key/);
  });

  it("still accepts username + app password as HTTP Basic", () => {
    const auth = authFromHeadersOrConfig(undefined, "east.hill@example.com", undefined, "app_exampletoken");
    expect(auth).toBeInstanceOf(BasicAuthProvider);
    expect(auth.header().startsWith("Basic ")).toBe(true);
  });

  it("sends OAuth access tokens as Bearer", () => {
    const auth = authFromHeadersOrConfig(undefined, "east.hill@example.com", "eyJhbGciOiJIUzI1NiJ9.e30.x", undefined);
    expect(auth).toBeInstanceOf(BearerAuthProvider);
  });
});

describe("discoverSession redirects", () => {
  it("does not follow an off-origin Location", async () => {
    let evilHits = 0;
    const evil = createServer((_req, res) => {
      evilHits += 1;
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ssrf-hit");
    });
    await new Promise<void>((resolve) => evil.listen(0, "127.0.0.1", () => resolve()));
    const evilPort = (evil.address() as { port: number }).port;
    const good = createServer((req, res) => {
      if (req.url === "/.well-known/jmap") {
        res.writeHead(302, { Location: `http://127.0.0.1:${evilPort}/evil` }).end();
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => good.listen(0, "127.0.0.1", () => resolve()));
    const origin = `http://127.0.0.1:${(good.address() as { port: number }).port}`;
    await expect(discoverSession(origin, new BearerAuthProvider("x"))).rejects.toMatchObject({ code: "crossOriginRedirect" });
    expect(evilHits).toBe(0);
    await new Promise<void>((resolve) => good.close(() => resolve()));
    await new Promise<void>((resolve) => evil.close(() => resolve()));
  });
});
