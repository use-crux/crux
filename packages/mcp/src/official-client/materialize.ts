import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type {
  McpToolSource,
  McpTransportConfig,
  McpTransportResolutionContext,
} from "../index";
import { discoverMcpTools } from "./discovery";
import {
  McpToolSourceError,
  mcpToolSourceError,
  mcpTransportErrorContext,
} from "./errors";
import { createOfficialClientTransport } from "./transport";
import type { McpToolSourceSession } from "./types";

/**
 * Materialize one MCP source through the official TypeScript client.
 *
 * The returned session owns the client connection and must be closed by the
 * surrounding Crux invocation after its ordinary tool lifecycle completes.
 */
export async function materializeMcpToolSource<TRuntimeContext>(
  source: McpToolSource<TRuntimeContext>,
  context: McpTransportResolutionContext<TRuntimeContext>,
): Promise<McpToolSourceSession> {
  let config: McpTransportConfig;
  try {
    config = await resolveTransport(source, context);
  } catch (error) {
    throw new McpToolSourceError(
      "transport-configuration",
      { serverId: source.id },
      error,
    );
  }
  const errorContext = mcpTransportErrorContext(source.id, config);

  const client = new Client({ name: "@use-crux/mcp", version: "0.5.0" });
  let transport: ReturnType<typeof createOfficialClientTransport>;
  try {
    transport = createOfficialClientTransport(config);
  } catch (error) {
    throw mcpToolSourceError("transport-configuration", errorContext, error);
  }

  try {
    try {
      await client.connect(
        transport,
        context.abortSignal ? { signal: context.abortSignal } : undefined,
      );
    } catch (error) {
      throw mcpToolSourceError("connect", errorContext, error);
    }
    let discovered: Awaited<ReturnType<typeof discoverMcpTools>>;
    try {
      discovered = await discoverMcpTools(
        client,
        source,
        errorContext,
        context.abortSignal,
      );
    } catch (error) {
      throw mcpToolSourceError("discover", errorContext, error);
    }
    let closed = false;
    return {
      ...discovered,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await client.close();
        } catch (error) {
          throw mcpToolSourceError("close", errorContext, error);
        }
      },
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

async function resolveTransport<TRuntimeContext>(
  source: McpToolSource<TRuntimeContext>,
  context: McpTransportResolutionContext<TRuntimeContext>,
): Promise<McpTransportConfig> {
  return typeof source.transport === "function"
    ? source.transport(context)
    : source.transport;
}
