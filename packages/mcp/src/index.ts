/**
 * `@use-crux/mcp` — portable, inert MCP tool-source definitions.
 *
 * Creating a definition performs no connection, discovery, or process spawn.
 * The selected Crux execution dialect owns those effects per invocation.
 *
 * @module
 */

import { TOOL_SOURCE, type ToolSource } from "@use-crux/core/tools";

/** Configuration for an MCP server transported over stdio. */
export interface McpStdioTransportConfig {
  readonly type: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Configuration for an MCP Streamable HTTP endpoint. */
export interface McpStreamableHttpTransportConfig {
  readonly type: "streamable-http";
  readonly url: string | URL;
  readonly headers?: Readonly<Record<string, string>>;
  readonly redirect?: "error" | "follow";
}

/** Transport configuration supported by the initial MCP client release. */
export type McpTransportConfig =
  | McpStdioTransportConfig
  | McpStreamableHttpTransportConfig;

/** Context supplied when an MCP transport is resolved for an invocation. */
export interface McpTransportResolutionContext<TRuntimeContext> {
  readonly runtimeContext: TRuntimeContext;
  readonly abortSignal?: AbortSignal;
}

/** Resolve fresh transport configuration from invocation context. */
export type McpTransportResolver<TRuntimeContext> = (
  context: McpTransportResolutionContext<TRuntimeContext>,
) => McpTransportConfig | PromiseLike<McpTransportConfig>;

/** Mutually exclusive remote-tool selection and exposed-name prefixing. */
export type McpToolSelection =
  | {
      readonly allow: readonly string[];
      readonly deny?: never;
      readonly prefix?: string;
    }
  | {
      readonly deny: readonly string[];
      readonly allow?: never;
      readonly prefix?: string;
    }
  | {
      readonly allow?: never;
      readonly deny?: never;
      readonly prefix?: string;
    };

/** Authoring options for {@link mcp}. */
export interface McpConfig<TRuntimeContext = unknown> {
  readonly id: string;
  readonly transport:
    | McpTransportConfig
    | McpTransportResolver<TRuntimeContext>;
  readonly tools?: McpToolSelection;
}

/** Frozen MCP server definition accepted by prompt `use[]`. */
export interface McpToolSource<
  TRuntimeContext = unknown,
> extends ToolSource<"mcp"> {
  readonly transport:
    | McpTransportConfig
    | McpTransportResolver<TRuntimeContext>;
  readonly tools?: McpToolSelection;
}

/**
 * Define an inert MCP server tool source.
 *
 * @param config - Stable server identity, transport, and optional tool filter.
 * @returns A frozen definition that can be composed through prompt `use[]`.
 */
export function mcp<TRuntimeContext = unknown>(
  config: McpConfig<TRuntimeContext>,
): McpToolSource<TRuntimeContext> {
  if (typeof config.id !== "string" || !config.id.trim()) {
    throw new Error("mcp(): id must be non-empty.");
  }
  if (config.tools?.allow !== undefined && config.tools.deny !== undefined) {
    throw new Error(
      "mcp(): tools.allow and tools.deny are mutually exclusive.",
    );
  }
  const transport =
    typeof config.transport === "function"
      ? config.transport
      : copyTransport(config.transport);
  return Object.freeze({
    [TOOL_SOURCE]: true as const,
    _tag: "ToolSource" as const,
    kind: "mcp" as const,
    id: config.id,
    transport,
    ...(config.tools ? { tools: copySelection(config.tools) } : {}),
  });
}

/** Create inert stdio transport configuration. */
export function stdio(
  config: Omit<McpStdioTransportConfig, "type">,
): McpStdioTransportConfig {
  return copyStdio({ type: "stdio", ...config });
}

/** Create inert Streamable HTTP transport configuration. */
export function streamableHttp(
  config: Omit<McpStreamableHttpTransportConfig, "type">,
): McpStreamableHttpTransportConfig {
  return copyStreamableHttp({ type: "streamable-http", ...config });
}

function copyTransport(config: McpTransportConfig): McpTransportConfig {
  return config.type === "stdio"
    ? copyStdio(config)
    : copyStreamableHttp(config);
}

function copyStdio(config: McpStdioTransportConfig): McpStdioTransportConfig {
  return Object.freeze({
    type: "stdio",
    command: config.command,
    ...(config.args ? { args: Object.freeze([...config.args]) } : {}),
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(config.env ? { env: Object.freeze({ ...config.env }) } : {}),
  });
}

function copyStreamableHttp(
  config: McpStreamableHttpTransportConfig,
): McpStreamableHttpTransportConfig {
  return Object.freeze({
    type: "streamable-http",
    url: typeof config.url === "string" ? config.url : config.url.toString(),
    ...(config.headers
      ? { headers: Object.freeze({ ...config.headers }) }
      : {}),
    ...(config.redirect !== undefined ? { redirect: config.redirect } : {}),
  });
}

function copySelection(selection: McpToolSelection): McpToolSelection {
  if (selection.allow !== undefined) {
    return Object.freeze({
      allow: Object.freeze([...selection.allow]),
      ...(selection.prefix !== undefined ? { prefix: selection.prefix } : {}),
    });
  }
  if (selection.deny !== undefined) {
    return Object.freeze({
      deny: Object.freeze([...selection.deny]),
      ...(selection.prefix !== undefined ? { prefix: selection.prefix } : {}),
    });
  }
  return Object.freeze({
    ...(selection.prefix !== undefined ? { prefix: selection.prefix } : {}),
  });
}

export { materializeMcpToolSource } from "./official-client/materialize";
export { materializeAiSdkMcpToolSource } from "./ai-sdk/materialize";
export type {
  AiSdkMcpMaterializedTool,
  AiSdkMcpToolSourceSession,
} from "./ai-sdk/types";
export { McpToolSourceError } from "./official-client/errors";
export type {
  McpToolSourceErrorContext,
  McpToolSourceErrorPhase,
  McpTransportKind,
} from "./official-client/errors";
export type { McpContent, McpToolResult } from "./official-client/result";
export type {
  McpDiscoveredToolMetadata,
  McpDiscoveryMetadata,
  McpMaterializedTool,
  McpToolSourceSession,
} from "./official-client/types";
