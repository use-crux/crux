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
import {
  mcpPreparationObservation,
  openMcpConnectSpan,
  openMcpDiscoverSpan,
  setMcpTransportAttributes,
  withMcpSessionProvenance,
  withMcpToolProvenance,
} from "../observability";
import {
  enqueueMcpDiscoveryFailure,
  enqueueMcpDiscoveryUpdate,
} from "../project-index";

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
  const connect = openMcpConnectSpan(mcpSource.id, "official-client");
  let config: McpTransportConfig;
  try {
    config = await resolveTransport(mcpSource, context);
  } catch (error) {
    const failure = new McpToolSourceError(
      "transport-configuration",
      { serverId: mcpSource.id },
      error,
    );
    connect.error(failure, { failurePhase: failure.phase });
    enqueueMcpDiscoveryFailure({
      serverId: mcpSource.id,
      updateId: `mcp:${connect.spanId}:failure`,
      phase: failure.phase,
      category: "mcp-transport",
    });
    throw failure;
  }
  const errorContext = mcpTransportErrorContext(mcpSource.id, config);
  setMcpTransportAttributes(connect, errorContext);

  const client = new Client({ name: "@use-crux/mcp", version: "0.5.0" });
  let transport: ReturnType<typeof createOfficialClientTransport>;
  try {
    transport = createOfficialClientTransport(config);
  } catch (error) {
    const failure = mcpToolSourceError(
      "transport-configuration",
      errorContext,
      error,
    );
    connect.error(failure, { failurePhase: failure.phase });
    enqueueMcpDiscoveryFailure({
      serverId: mcpSource.id,
      updateId: `mcp:${connect.spanId}:failure`,
      phase: failure.phase,
      category: "mcp-transport",
    });
    throw failure;
  }

  try {
    try {
      await client.connect(
        transport,
        context.abortSignal ? { signal: context.abortSignal } : undefined,
      );
    } catch (error) {
      const failure = mcpToolSourceError("connect", errorContext, error);
      connect.error(failure, { failurePhase: failure.phase });
      enqueueMcpDiscoveryFailure({
        serverId: mcpSource.id,
        updateId: `mcp:${connect.spanId}:failure`,
        phase: failure.phase,
        category: "mcp-connect",
      });
      throw failure;
    }
    const server = client.getServerVersion();
    const protocolVersion =
      "protocolVersion" in transport &&
      typeof transport.protocolVersion === "string"
        ? transport.protocolVersion
        : undefined;
    connect.end({
      attributes: {
        ...(protocolVersion ? { protocolVersion } : {}),
        ...(server?.name ? { serverName: server.name } : {}),
        ...(server?.version ? { serverVersion: server.version } : {}),
      },
    });
    const discover = openMcpDiscoverSpan(
      connect,
      mcpSource.id,
      "official-client",
      errorContext,
    );
    const preparation = mcpPreparationObservation({
      sourceId: mcpSource.id,
      implementation: "official-client",
      connect,
      discover,
      transport: errorContext,
    });
    let discovered: Awaited<ReturnType<typeof discoverMcpTools>>;
    try {
      discovered = await discoverMcpTools(
        client,
        mcpSource,
        errorContext,
        context.abortSignal,
      );
    } catch (error) {
      const failure = mcpToolSourceError("discover", errorContext, error);
      discover.error(failure, { failurePhase: failure.phase });
      enqueueMcpDiscoveryFailure({
        serverId: mcpSource.id,
        updateId: `${preparation.sourceSessionId}:failure`,
        phase: failure.phase,
        category: "mcp-discovery",
      });
      throw failure;
    }
    discover.end({
      attributes: {
        ...discovered.observation,
        exposedToolCount: discovered.discovery.tools.length,
        toolListFingerprint: discovered.discovery.toolListFingerprint,
      },
    });
    enqueueMcpDiscoveryUpdate({
      serverId: mcpSource.id,
      sourceSessionId: preparation.sourceSessionId,
      toolListFingerprint: discovered.discovery.toolListFingerprint,
      tools: discovered.projected,
      ownerFacts: {
        implementation: "official-client",
        ...(protocolVersion ? { protocolVersion } : {}),
        ...(server ? { server } : {}),
      },
    });
    const tools = Object.fromEntries(
      Object.entries(discovered.tools).map(([name, tool]) => [
        name,
        withMcpToolProvenance(tool, tool.mcp, preparation),
      ]),
    );
    let closed = false;
    return withMcpSessionProvenance(
      {
        tools,
        discovery: discovered.discovery,
        async close() {
          if (closed) return;
          closed = true;
          try {
            await client.close();
          } catch (error) {
            throw mcpToolSourceError("close", errorContext, error);
          }
        },
      },
      preparation,
    );
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
