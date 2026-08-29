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
      http: "Authorization: Bearer <app-password-or-oauth-token>, or Basic",
      stdio: "Environment BEARMAIL_USERNAME + BEARMAIL_PASSWORD for a Stalwart app password (HTTP Basic). BEARMAIL_TOKEN is an OAuth bearer token. Never put the human primary password here.",
    },
    transports: {
      stdio: {
        command: "bearmail-mcp",
        env: ["BEARMAIL_SERVER", "BEARMAIL_USERNAME", "BEARMAIL_PASSWORD"],
      },
      http: transports?.http
        ? { url: transports.http, authentication: "bearer" }
        : { url: `${origin}/mcp`, authentication: "bearer", note: "Published when bearmail-mcp-http is reverse-proxied on this host." },
    },
  };
}
