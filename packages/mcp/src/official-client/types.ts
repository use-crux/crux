import type { ToolDef, ToolSourceSession } from "@use-crux/core/tools";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { McpToolResult } from "./result";

/** Stable identity discovered for one remote MCP tool. */
export interface McpDiscoveredToolMetadata {
  readonly serverId: string;
  readonly remoteName: string;
  readonly exposedName: string;
  readonly inputSchemaFingerprint: string;
  readonly outputSchemaFingerprint?: string;
  readonly toolListFingerprint: string;
  /** Untrusted server hints; policy must never treat them as authority. */
  readonly annotations?: Readonly<ToolAnnotations>;
}

/** Ordinary Crux tool produced by the official MCP client materializer. */
export interface McpMaterializedTool extends ToolDef<
  Record<string, unknown>,
  McpToolResult
> {
  readonly mcp: McpDiscoveredToolMetadata;
}

/** Stable projection of one invocation's discovered MCP tool list. */
export interface McpDiscoveryMetadata {
  readonly toolListFingerprint: string;
  readonly tools: readonly McpDiscoveredToolMetadata[];
}

/** Per-invocation official-client session and its discovery identity. */
export interface McpToolSourceSession extends ToolSourceSession {
  readonly tools: Readonly<Record<string, McpMaterializedTool>>;
  readonly discovery: McpDiscoveryMetadata;
}
