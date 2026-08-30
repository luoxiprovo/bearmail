# bearmail-mcp

MCP server for BearMail. Agents use typed tools; Stalwart JMAP remains the store. Authenticate with a Stalwart **API key** (`API_…`) in `BEARMAIL_TOKEN` (Bearer). Default send mode is **draft-only**. Do not use a human login password or an `app_…` application password.

- Quickstart: [`docs/QUICKSTART.md`](../docs/QUICKSTART.md)
- Spec: [`docs/AGENT_MCP_SPEC.md`](../docs/AGENT_MCP_SPEC.md)
- Agent guide: [`docs/AGENT_GUIDE.md`](../docs/AGENT_GUIDE.md)
- Cursor example: [`mcp.json.example`](./mcp.json.example)

On a host that already has BearMail:

```sh
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sudo bash
```

From this directory:

```sh
npm install
npm test
npm run build
BEARMAIL_SERVER=https://mail.example.com \
BEARMAIL_USERNAME=scheduler@example.com \
BEARMAIL_TOKEN=API_... \
node dist/stdio.js
```
