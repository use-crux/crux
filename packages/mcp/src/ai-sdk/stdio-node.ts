import type { McpStdioTransportConfig } from "../index";
import type { MCPTransport } from "./client";

/** Materialize the AI SDK's Node-only stdio transport on demand. */
export async function createAiSdkStdioTransport(
  config: McpStdioTransportConfig,
): Promise<MCPTransport> {
  const { Experimental_StdioMCPTransport } =
    await import("@ai-sdk/mcp/mcp-stdio");
  return new Experimental_StdioMCPTransport({
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(config.env ? { env: { ...config.env } } : {}),
  });
}
