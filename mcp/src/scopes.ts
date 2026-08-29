import type { Scope } from "./types.js";
import { ToolError } from "./errors.js";

const TOOL_SCOPES: Record<string, Scope[]> = {
  whoami: [],
  list_identities: ["mail.read", "mail.send", "mail.draft"],
  list_mailboxes: ["mail.read"],
  list_inbox: ["mail.read"],
  search_mail: ["mail.read"],
  get_thread: ["mail.read"],
  download_attachment: ["mail.read"],
  save_draft: ["mail.draft"],
  send_email: ["mail.send"],
  reply: ["mail.send"],
  set_mail_state: ["mail.read"],
  list_calendars: ["calendar.read"],
  list_events: ["calendar.read"],
  get_event: ["calendar.read"],
  get_availability: ["calendar.read"],
  create_event: ["calendar.write"],
  update_event: ["calendar.write"],
  rsvp: ["calendar.write"],
  cancel_event: ["calendar.write"],
};

export function requiredScopes(tool: string): Scope[] {
  return TOOL_SCOPES[tool] ?? [];
}

export function assertScope(tool: string, granted: Set<Scope>): void {
  const needed = requiredScopes(tool);
  if (!needed.length) return;
  if (needed.some((scope) => granted.has(scope))) return;
  throw new ToolError(
    `This token does not include ${needed.join(" or ")}. Ask the administrator to grant that scope.`,
    "missingScope",
  );
}
