import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BearmailAccount } from "../src/account.js";
import { loadConfig } from "../src/config.js";
import { BasicAuthProvider, discoverSession, JmapClient } from "../src/jmap.js";
import { createMcpServer } from "../src/server.js";
import { startHttpServer } from "../src/http.js";
import { startMockJmap, type MockJmap } from "./mock-jmap.js";

let mock: MockJmap | undefined;
let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;

afterEach(async () => {
  if (http) {
    await new Promise<void>((resolve, reject) => {
      http!.server.close((error) => error ? reject(error) : resolve());
    });
    http = undefined;
  }
  await mock?.close();
  mock = undefined;
});

describe("MCP protocol", () => {
  it("lists tools and returns JSON from whoami over an in-memory transport", async () => {
    mock = await startMockJmap();
    const config = loadConfig({
      BEARMAIL_SERVER: mock.origin,
      BEARMAIL_USERNAME: "ada@example.test",
      BEARMAIL_PASSWORD: "app-pass",
      BEARMAIL_SEND_MODE: "send-allowed",
      BEARMAIL_SCOPES: "mail.read,mail.send,mail.draft,calendar.read,calendar.write",
    });
    const auth = new BasicAuthProvider("ada@example.test", "app-pass");
    const { session } = await discoverSession(mock.origin, auth);
    const server = createMcpServer(new BearmailAccount(new JmapClient(session, auth, mock.origin), config));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["whoami", "send_email", "create_event"]));
    expect(names).not.toContain("admin");
    const result = await client.callTool({ name: "whoami", arguments: {} });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.username).toBe("ada@example.test");
    await client.close();
    await server.close();
  });

  it("requires Authorization on HTTP MCP and serves discovery without secrets", async () => {
    mock = await startMockJmap();
    const config = loadConfig({
      BEARMAIL_SERVER: mock.origin,
      BEARMAIL_USERNAME: "ada@example.test",
      BEARMAIL_PASSWORD: "app-pass",
      BEARMAIL_MCP_PORT: "0",
    });
    http = await startHttpServer({ ...config, httpPort: 0, httpHost: "127.0.0.1" });
    const discovery = await fetch(`${http.origin}/.well-known/mcp.json`);
    expect(discovery.ok).toBe(true);
    const doc = await discovery.json() as { transports: unknown };
    expect(JSON.stringify(doc)).not.toContain("secret-s3cret");
    const unauthorized = await fetch(`${http.origin}${http.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
    });
    expect(unauthorized.status).toBe(401);
    const garbage = await fetch(`${http.origin}${http.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "NotBearer garbage" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
    });
    expect(garbage.status).toBe(401);
    const appPasswordBearer = await fetch(`${http.origin}${http.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app_exampletoken" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
    });
    expect(appPasswordBearer.status).toBe(401);
    const appPasswordBody = await appPasswordBearer.json() as { error: { message: string } };
    expect(appPasswordBody.error.message).toMatch(/API key/);
    expect(doc.transports).toBeTruthy();
    const advertised = JSON.stringify(doc);
    expect(advertised).toContain(http.origin);
  });
});
