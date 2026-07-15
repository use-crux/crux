import { mcp, type McpStdioTransportConfig } from "@use-crux/mcp";

/**
 * Create the stdio source used by the MCP guide.
 *
 * Accepting an already separated command/argument configuration keeps the
 * example shell-free and lets its test use the real spawned fixture process.
 */
export function createStdioExampleSource(transport: McpStdioTransportConfig) {
  return mcp({
    id: "local-files",
    transport,
    tools: { allow: ["read_file"], prefix: "files_" },
  });
}
