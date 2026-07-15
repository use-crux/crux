import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpStdioTransportConfig } from "../index";

/** Materialize the official client's Node-only stdio transport on demand. */
export async function createOfficialStdioTransport(
  config: McpStdioTransportConfig,
): Promise<Transport> {
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  return new StdioClientTransport({
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(config.env ? { env: { ...config.env } } : {}),
  });
}
