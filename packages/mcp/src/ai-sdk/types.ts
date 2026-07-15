import type { MCPClient } from "@ai-sdk/mcp";
import type { ToolSourceSession } from "@use-crux/core/tools";

import type { McpToolResult } from "../official-client/result";
import type {
  McpDiscoveredToolMetadata,
  McpDiscoveryMetadata,
  McpMaterializedTool,
} from "../official-client/types";

type NativeMcpTool = NonNullable<
  ReturnType<MCPClient["toolsFromDefinitions"]>[string]
>;
type NativeToModelOutput = NonNullable<NativeMcpTool["toModelOutput"]>;

/** AI SDK-native tool with Crux validation, result, and origin metadata. */
export type AiSdkMcpMaterializedTool = Omit<
  NativeMcpTool,
  "execute" | "toModelOutput"
> &
  Pick<McpMaterializedTool, "parameters"> & {
    readonly description: string;
    readonly mcp: McpDiscoveredToolMetadata;
    execute: McpMaterializedTool["execute"];
    readonly toModelOutput?: (
      args: Omit<Parameters<NativeToModelOutput>[0], "output"> & {
        readonly output: McpToolResult;
      },
    ) => ReturnType<NativeToModelOutput>;
  };

/** Per-invocation AI SDK-native MCP session. */
export interface AiSdkMcpToolSourceSession extends ToolSourceSession {
  readonly tools: Readonly<Record<string, AiSdkMcpMaterializedTool>>;
  readonly discovery: McpDiscoveryMetadata;
}
