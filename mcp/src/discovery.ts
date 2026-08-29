export function discoveryDocument(serverOrigin: string, transports?: { http?: string }) {
  const origin = serverOrigin.replace(/\/$/, "");
  return {
    name: "BearMail",
    version: "1",
    description: "MCP tools for a BearMail mailbox and calendar. JMAP remains the store. Email and iMIP federate to other domains.",
    jmap: `${origin}/.well-known/jmap`,
    oauthAuthorizationServer: `${origin}/.well-known/oauth-authorization-server`,
    documentation: "docs/AGENT_GUIDE.md",
    spec: "docs/AGENT_MCP_SPEC.md",
    authentication: {
      http: "Authorization: Bearer <Stalwart-API-key>",
      stdio: "Environment BEARMAIL_TOKEN=API_… (Stalwart API key, Bearer). Optional BEARMAIL_USERNAME for the mailbox address. Never the human primary password or an app_… password.",
    },
    transports: {
      stdio: {
        command: "bearmail-mcp",
        env: ["BEARMAIL_SERVER", "BEARMAIL_USERNAME", "BEARMAIL_TOKEN"],
      },
      http: transports?.http
        ? { url: transports.http, authentication: "bearer" }
        : { url: `${origin}/mcp`, authentication: "bearer", note: "Published when bearmail-mcp-http is reverse-proxied on this host." },
    },
  };
}
