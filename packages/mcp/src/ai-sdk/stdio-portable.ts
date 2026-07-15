import type { McpStdioTransportConfig } from "../index";
import type { MCPTransport } from "./client";

/** Fail closed when a portable runtime selects a Node-only stdio transport. */
export function createAiSdkStdioTransport(
  _config: McpStdioTransportConfig,
): Promise<MCPTransport> {
  throw new TypeError(
    "MCP stdio transports require a Node runtime. Use streamableHttp() in portable runtimes.",
  );
}
