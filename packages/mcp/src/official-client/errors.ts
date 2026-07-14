import type { McpTransportConfig } from "../index";

/** Stable setup phase attached to an MCP source failure. */
export type McpToolSourceErrorPhase =
  | "transport-configuration"
  | "connect"
  | "initialize"
  | "discover"
  | "filter"
  | "schema"
  | "merge"
  | "close"
  | "resume-validation";

/** Transport identity safe to expose in logs and error reports. */
export type McpTransportKind = McpTransportConfig["type"];

/** Safe source and transport identity retained by structured MCP errors. */
export interface McpToolSourceErrorContext {
  readonly serverId: string;
  readonly transportKind?: McpTransportKind;
  readonly endpoint?: string;
}

/**
 * Structured failure raised while materializing an MCP tool source.
 *
 * Endpoint credentials and query parameters are removed, and the retained
 * cause is sanitized before crossing the public package boundary.
 */
export class McpToolSourceError extends Error {
  readonly code = "MCP_TOOL_SOURCE_ERROR" as const;
  readonly serverId: string;
  readonly phase: McpToolSourceErrorPhase;
  readonly transportKind?: McpTransportKind;
  readonly endpoint?: string;

  constructor(
    phase: McpToolSourceErrorPhase,
    context: McpToolSourceErrorContext,
    cause?: unknown,
  ) {
    const detail =
      cause === undefined ? undefined : sanitizeCauseMessage(cause);
    super(
      `MCP source "${context.serverId}" failed during ${phase}.` +
        (detail ? ` ${detail}` : ""),
      {
        ...(cause === undefined ? {} : { cause: new Error(detail) }),
      },
    );
    this.name = "McpToolSourceError";
    this.serverId = context.serverId;
    this.phase = phase;
    this.transportKind = context.transportKind;
    this.endpoint = context.endpoint;
  }
}

/** Preserve an existing structured boundary or wrap an unsafe dependency error. */
export function mcpToolSourceError(
  phase: McpToolSourceErrorPhase,
  context: McpToolSourceErrorContext,
  cause: unknown,
): McpToolSourceError {
  return cause instanceof McpToolSourceError
    ? cause
    : new McpToolSourceError(phase, context, cause);
}

/** Derive transport identity without retaining headers, credentials, or query. */
export function mcpTransportErrorContext(
  serverId: string,
  transport: McpTransportConfig,
): McpToolSourceErrorContext {
  return {
    serverId,
    transportKind: transport.type,
    ...(transport.type === "streamable-http"
      ? { endpoint: safeHttpEndpoint(transport.url) }
      : {}),
  };
}

function safeHttpEndpoint(value: string | URL): string | undefined {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function sanitizeCauseMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message
    .replace(/https?:\/\/[^\s"'<>]+/giu, sanitizeMatchedUrl)
    .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|api[-_]?key|token|secret|password)\s*[:=]\s*\S+/giu,
      "$1=[REDACTED]",
    );
}

function sanitizeMatchedUrl(value: string): string {
  return safeHttpEndpoint(value) ?? "[REDACTED URL]";
}
