/**
 * AI SDK-native MCP materialization.
 *
 * Connection, protocol discovery, native tool construction, and model-output
 * conversion stay owned by `@ai-sdk/mcp`. Crux adds portable selection,
 * validation, application-result normalization, metadata, and per-invocation
 * cleanup before Core's SDK tool lifecycle applies policy and evidence.
 *
 * @module
 */

import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  ToolSource,
  ToolSourceMaterializationContext,
} from "@use-crux/core/tools";
import { withToolSourceReplayIdentity } from "@use-crux/core/tools";

import type {
  McpToolSource,
  McpTransportConfig,
  McpTransportResolutionContext,
} from "../index";
import {
  projectMcpTools,
  type ProjectedMcpTool,
} from "../official-client/discovery";
import {
  McpToolSourceError,
  mcpToolSourceError,
  mcpTransportErrorContext,
  type McpToolSourceErrorContext,
} from "../official-client/errors";
import { normalizeMcpToolResult } from "../official-client/result";
import { mcpInputSchema, mcpOutputSchema } from "../official-client/schema";
import { canonicalFingerprint } from "../official-client/canonical";
import { mcpApprovalReplayIdentity } from "../official-client/approval-replay";
import { createSafeRedirectFetch } from "../official-client/transport";
import {
  createAiSdkMcpClient,
  type MCPClient,
  type MCPTransport,
} from "./client";
import type {
  AiSdkMcpMaterializedTool,
  AiSdkMcpToolSourceSession,
} from "./types";
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
import { assertMcpTransportConfig } from "../configuration";

const MAX_DISCOVERY_PAGES = 64;

/** Materialize one branded MCP source with the AI SDK's native MCP client. */
export async function materializeAiSdkMcpToolSource(
  source: ToolSource,
  context: ToolSourceMaterializationContext,
): Promise<AiSdkMcpToolSourceSession> {
  const mcpSource = assertMcpSource(source);
  const connect = openMcpConnectSpan(source.id, "ai-sdk-native");
  let config: McpTransportConfig;
  try {
    config = await resolveTransport(mcpSource, context);
  } catch (error) {
    const failure = new McpToolSourceError(
      "transport-configuration",
      { serverId: source.id },
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
  const errorContext = mcpTransportErrorContext(source.id, config);
  setMcpTransportAttributes(connect, errorContext);
  let transport: ReturnType<typeof createNativeTransport>;
  try {
    transport = createNativeTransport(config);
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

  let client: MCPClient;
  try {
    client = await createAiSdkMcpClient({
      clientName: "@use-crux/mcp",
      version: "0.5.0",
      transport,
    });
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
  connect.end({
    attributes: {
      ...(typeof transport === "object" &&
      "protocolVersion" in transport &&
      typeof transport.protocolVersion === "string"
        ? { protocolVersion: transport.protocolVersion }
        : {}),
      ...(client.serverInfo?.name
        ? { serverName: client.serverInfo.name }
        : {}),
      ...(client.serverInfo?.version
        ? { serverVersion: client.serverInfo.version }
        : {}),
    },
  });
  const discover = openMcpDiscoverSpan(
    connect,
    source.id,
    "ai-sdk-native",
    errorContext,
  );
  const preparation = mcpPreparationObservation({
    sourceId: source.id,
    implementation: "ai-sdk-native",
    connect,
    discover,
    transport: errorContext,
  });

  try {
    const definitions = await discoverNativeTools(client, context.abortSignal);
    const projected = projectMcpTools(
      definitions.tools as readonly Tool[],
      mcpSource,
      errorContext,
    );
    const selectedDefinitions = {
      tools: projected.map(({ tool }) => tool),
      nextCursor: undefined,
    };
    const nativeTools = client.toolsFromDefinitions(
      selectedDefinitions as Parameters<MCPClient["toolsFromDefinitions"]>[0],
    );
    const tools = Object.fromEntries(
      projected.map((entry) => [
        entry.exposedName,
        withMcpToolProvenance(
          wrapNativeTool(
            entry,
            nativeTools[entry.tool.name]!,
            context,
            errorContext,
          ),
          entry.metadata,
          preparation,
        ),
      ]),
    );
    const toolListFingerprint =
      projected[0]?.metadata.toolListFingerprint ?? canonicalFingerprint([]);
    discover.end({
      attributes: {
        pageCount: definitions.pageCount,
        discoveredToolCount: definitions.tools.length,
        selectedToolCount: projected.length,
        allowedToolCount: projected.length,
        deniedToolCount: definitions.tools.length - projected.length,
        exposedToolCount: projected.length,
        toolListFingerprint,
      },
    });
    enqueueMcpDiscoveryUpdate({
      serverId: mcpSource.id,
      sourceSessionId: preparation.sourceSessionId,
      toolListFingerprint,
      tools: projected,
      ownerFacts: {
        implementation: "ai-sdk-native",
        ...(typeof transport === "object" &&
        "protocolVersion" in transport &&
        typeof transport.protocolVersion === "string"
          ? { protocolVersion: transport.protocolVersion }
          : {}),
        ...(client.serverInfo ? { server: client.serverInfo } : {}),
      },
    });
    let closed = false;
    return withMcpSessionProvenance(
      {
        tools,
        discovery: {
          toolListFingerprint,
          tools: projected.map(({ metadata }) => metadata),
        },
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
}

async function discoverNativeTools(
  client: MCPClient,
  abortSignal?: AbortSignal,
): Promise<{
  readonly tools: Awaited<ReturnType<MCPClient["listTools"]>>["tools"];
  readonly pageCount: number;
}> {
  const tools: Awaited<ReturnType<MCPClient["listTools"]>>["tools"] = [];
  const requestedCursors = new Set<string>();
  let pageCount = 0;
  let cursor: string | undefined;

  do {
    if (pageCount >= MAX_DISCOVERY_PAGES) {
      throw new Error(
        `MCP tools/list exceeded the ${MAX_DISCOVERY_PAGES}-page discovery limit.`,
      );
    }
    if (cursor !== undefined) {
      if (requestedCursors.has(cursor)) {
        throw new Error(`MCP tools/list cursor loop detected at "${cursor}".`);
      }
      requestedCursors.add(cursor);
    }
    pageCount += 1;
    const page = await client.listTools({
      ...(cursor === undefined ? {} : { params: { cursor } }),
      ...(abortSignal ? { options: { signal: abortSignal } } : {}),
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  return { tools, pageCount };
}

function wrapNativeTool(
  projected: ProjectedMcpTool,
  nativeTool: NonNullable<
    ReturnType<MCPClient["toolsFromDefinitions"]>[string]
  >,
  context: ToolSourceMaterializationContext,
  errorContext: McpToolSourceErrorContext,
): AiSdkMcpMaterializedTool {
  if (!nativeTool || typeof nativeTool.execute !== "function") {
    throw new TypeError(
      `@ai-sdk/mcp did not construct executable tool "${projected.tool.name}".`,
    );
  }
  let parameters: ReturnType<typeof mcpInputSchema>;
  let outputSchema: ReturnType<typeof mcpOutputSchema> | undefined;
  try {
    parameters = mcpInputSchema(projected.tool.inputSchema);
    outputSchema = projected.tool.outputSchema
      ? mcpOutputSchema(projected.tool.outputSchema)
      : undefined;
  } catch (error) {
    throw mcpToolSourceError("schema", errorContext, error);
  }

  return withToolSourceReplayIdentity(
    {
      ...nativeTool,
      description: projected.tool.description ?? projected.tool.name,
      parameters,
      async execute(input, options) {
        const validatedInput = await parameters.parseAsync(input);
        const abortSignal = options.abortSignal ?? context.abortSignal;
        abortSignal?.throwIfAborted();
        const result = await nativeTool.execute!(validatedInput, {
          ...options,
          messages: options.messages ?? [],
          abortSignal,
        } as never);
        const normalized = normalizeMcpToolResult(result);
        if (outputSchema && normalized.structuredContent === undefined) {
          if (!normalized.isError) {
            throw new TypeError(
              `MCP tool "${projected.tool.name}" advertised an output schema but returned no structured content.`,
            );
          }
        } else if (outputSchema && normalized.structuredContent !== undefined) {
          const validation = await outputSchema.safeParseAsync(
            normalized.structuredContent,
          );
          if (!validation.success) {
            throw new TypeError(
              `MCP tool "${projected.tool.name}" returned structured content that does not match its output schema.`,
              { cause: validation.error },
            );
          }
        }
        return normalized;
      },
      mcp: projected.metadata,
    } as AiSdkMcpMaterializedTool,
    mcpApprovalReplayIdentity(projected.metadata),
  );
}

function createNativeTransport(config: McpTransportConfig):
  | MCPTransport
  | {
      readonly type: "http";
      readonly url: string;
      readonly headers?: Record<string, string>;
      readonly redirect: "error" | "follow";
      readonly fetch?: typeof globalThis.fetch;
    } {
  if (config.type === "stdio") {
    return new Experimental_StdioMCPTransport({
      command: config.command,
      ...(config.args ? { args: [...config.args] } : {}),
      ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
      ...(config.env ? { env: { ...config.env } } : {}),
    });
  }
  return {
    type: "http",
    url: String(config.url),
    ...(config.headers ? { headers: { ...config.headers } } : {}),
    redirect: config.redirect ?? "error",
    ...(config.redirect === "follow"
      ? {
          fetch: createSafeRedirectFetch(Object.keys(config.headers ?? {})),
        }
      : {}),
  };
}

function assertMcpSource(source: ToolSource): McpToolSource<unknown> {
  if (source.kind !== "mcp" || !("transport" in source)) {
    throw new TypeError(
      `Expected an MCP tool source, received kind "${source.kind}".`,
    );
  }
  return source as McpToolSource<unknown>;
}

async function resolveTransport(
  source: McpToolSource<unknown>,
  context: McpTransportResolutionContext<unknown>,
): Promise<McpTransportConfig> {
  const transport = await (typeof source.transport === "function"
    ? source.transport(context)
    : source.transport);
  assertMcpTransportConfig(transport);
  return transport;
}
