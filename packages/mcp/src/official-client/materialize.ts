import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  ToolSource,
  ToolSourceMaterializationContext,
} from "@use-crux/core/tools";

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
export function materializeMcpToolSource<TRuntimeContext>(
  source: McpToolSource<TRuntimeContext>,
  context: McpTransportResolutionContext<TRuntimeContext>,
): Promise<McpToolSourceSession>;
export function materializeMcpToolSource(
  source: ToolSource,
  context: ToolSourceMaterializationContext,
): Promise<McpToolSourceSession>;
export async function materializeMcpToolSource(
  source: ToolSource,
  context: ToolSourceMaterializationContext,
): Promise<McpToolSourceSession> {
  const mcpSource = assertMcpSource(source);
  let config: McpTransportConfig;
  try {
    config = await resolveTransport(mcpSource, context);
  } catch (error) {
    throw new McpToolSourceError(
      "transport-configuration",
      { serverId: mcpSource.id },
      error,
    );
  }
  const errorContext = mcpTransportErrorContext(mcpSource.id, config);

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
        mcpSource,
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

function assertMcpSource(source: ToolSource): McpToolSource<unknown> {
  if (source.kind !== "mcp" || !("transport" in source)) {
    throw new TypeError(
      `Expected an MCP tool source, received kind "${source.kind}".`,
    );
  }
  return source as McpToolSource<unknown>;
}

async function resolveTransport<TRuntimeContext>(
  source: McpToolSource<TRuntimeContext>,
  context: McpTransportResolutionContext<TRuntimeContext>,
): Promise<McpTransportConfig> {
  return typeof source.transport === "function"
    ? source.transport(context)
    : source.transport;
}
