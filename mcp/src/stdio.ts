#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { authFromHeadersOrConfig, discoverSession, JmapClient } from "./jmap.js";
import { BearmailAccount } from "./account.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const auth = authFromHeadersOrConfig(undefined, config.username, config.token, config.password);
  const { origin, session } = await discoverSession(config.server, auth);
  const account = new BearmailAccount(new JmapClient(session, auth, origin), config);
  const server = createMcpServer(account);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), result: "error", message: error instanceof Error ? error.message : "startup failed" }));
  process.exit(1);
});
