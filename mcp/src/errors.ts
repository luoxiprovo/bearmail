import type { ToolErrorBody } from "./types.js";

export class ToolError extends Error {
  readonly code: string;
  readonly jmapMethod?: string;

  constructor(message: string, code: string, jmapMethod?: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.jmapMethod = jmapMethod;
  }

  toJSON(): ToolErrorBody {
    return this.jmapMethod
      ? { code: this.code, message: this.message, jmapMethod: this.jmapMethod }
      : { code: this.code, message: this.message };
  }
}

export function toolErrorResult(error: unknown, debugJmap: boolean): { isError: true; content: Array<{ type: "text"; text: string }> } {
  const body = error instanceof ToolError
    ? error.toJSON()
    : { code: "internalError", message: error instanceof Error ? error.message : "The request failed." };
  if (!debugJmap && "details" in (error as object)) {
    delete (body as { details?: unknown }).details;
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

export function toolJson(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
