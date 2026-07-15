import type { McpTransportConfig } from "../index";

/** Stable setup phase attached to an MCP source failure. */
export type McpToolSourceErrorPhase =
  | "transport-configuration"
  | "connect"
  | "initialize"
  | "discover"
  | "filter"
  | "schema"
  | "execute"
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
 * Endpoint credentials and query parameters are removed. Dependency error
 * messages are never retained because runtime resolvers and transports may
 * receive opaque secrets that cannot be recognized by heuristic redaction.
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
    super(`MCP source "${context.serverId}" failed during ${phase}.`, {
      ...(cause === undefined
        ? {}
        : { cause: new Error("An MCP dependency failed.") }),
    });
    this.name = "McpToolSourceError";
    this.serverId = context.serverId;
    this.phase = phase;
    this.transportKind = context.transportKind;
    this.endpoint = context.endpoint;
  }
}

/** Create a structured failure with detail authored by Crux itself. */
export function mcpToolSourceContractError(
  phase: McpToolSourceErrorPhase,
  context: McpToolSourceErrorContext,
  detail: string,
): McpToolSourceError {
  const error = new McpToolSourceError(phase, context);
  error.message = `${error.message} ${detail}`;
  return error;
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
