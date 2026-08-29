import { appendFile } from "node:fs/promises";

export interface AuditEvent {
  tool: string;
  actor?: string;
  recipients?: string[];
  messageId?: string;
  calendarUid?: string;
  result: "ok" | "error";
  code?: string;
}

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    if (/token|password|secret|authorization/i.test(key)) copy[key] = "[redacted]";
  }
  return copy;
}

export async function writeAudit(path: string | undefined, event: AuditEvent): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...(redact(event) as Record<string, unknown>) });
  console.error(line);
  if (!path) return;
  try {
    await appendFile(path, `${line}\n`, { mode: 0o600 });
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), tool: "audit", result: "error", message: "Failed to write audit log." }));
  }
}
