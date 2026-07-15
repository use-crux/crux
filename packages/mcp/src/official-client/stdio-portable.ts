import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpStdioTransportConfig } from "../index";

/** Fail closed when a portable runtime selects a Node-only stdio transport. */
export function createOfficialStdioTransport(
  _config: McpStdioTransportConfig,
): Promise<Transport> {
  throw new TypeError(
    "MCP stdio transports require a Node runtime. Use streamableHttp() in portable runtimes.",
  );
}
