import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BearmailAccount } from "./account.js";
import { registerTools } from "./tools.js";
import { toolJson, toolErrorResult } from "./errors.js";

export function createMcpServer(account: BearmailAccount): McpServer {
  const server = new McpServer({
    name: "bearmail",
    version: "0.1.0",
  });
  registerTools(server, account);
  if (account.advertisedTools().includes("list_inbox")) {
    server.resource("inbox", "mail://inbox", { description: "Unread inbox summary for the authenticated mailbox." }, async () => {
      try {
        const summary = await account.run("list_inbox", () => account.inboxSummary());
        return { contents: [{ uri: "mail://inbox", mimeType: "application/json", text: toolJson(summary).content[0].text }] };
      } catch (error) {
        return { contents: [{ uri: "mail://inbox", mimeType: "application/json", text: toolErrorResult(error, account.config.debugJmap).content[0].text }] };
      }
    });
  }
  return server;
}
