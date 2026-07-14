/**
 * Secret-safe observability shared by both MCP client implementations.
 *
 * The MCP package owns preparation spans and supplies immutable provenance to
 * Core. Core remains source-agnostic: it only merges the supplied attributes,
 * definition refs, and causal span IDs into ordinary `tool.call` evidence.
 *
 * @module
 */

import {
  createCruxSpanId,
  mcpServerDefinitionRef,
  observe,
  toolDefinitionRef,
} from "@use-crux/core/observability";
import {
  withToolSourceProvenance,
  withToolSourceSessionProvenance,
  type ToolSourceSession,
} from "@use-crux/core/tools";

import type { McpToolSourceErrorContext } from "./official-client/errors";
import type { McpDiscoveredToolMetadata } from "./official-client/types";

/** Safe counts discovered while projecting a remote tool list. */
export interface McpDiscoveryObservation {
  readonly pageCount: number;
  readonly discoveredToolCount: number;
  readonly selectedToolCount: number;
  readonly allowedToolCount: number;
  readonly deniedToolCount: number;
}

/** Preparation identity retained for tool-call and cleanup causality. */
export interface McpPreparationObservation {
  readonly sourceId: string;
  readonly sourceSessionId: string;
  readonly implementation: "official-client" | "ai-sdk-native";
  readonly connect: ReturnType<typeof observe.openSpan>;
  readonly discover: ReturnType<typeof observe.openSpan>;
  readonly cleanupContext: ReturnType<typeof observe.captureContext>;
  readonly transport: McpToolSourceErrorContext;
}

/** Open the initialization span before transport construction or I/O. */
export function openMcpConnectSpan(
  sourceId: string,
  implementation: McpPreparationObservation["implementation"],
): ReturnType<typeof observe.openSpan> {
  const spanId = createCruxSpanId();
  return observe.openSpan({
    spanId,
    name: sourceId,
    primitive: "mcp.connect",
    attributes: {
      sourceKind: "mcp",
      sourceId,
      serverId: sourceId,
      sourceSessionId: `mcp:${spanId}`,
      implementation,
    },
    definitionRefs: [mcpServerDefinitionRef(sourceId)],
  });
}

/** Add only sanitized transport identity to an open preparation span. */
export function setMcpTransportAttributes(
  span: ReturnType<typeof observe.openSpan>,
  context: McpToolSourceErrorContext,
): void {
  span.setAttributes({
    ...(context.transportKind ? { transport: context.transportKind } : {}),
    ...(context.endpoint ? { endpoint: context.endpoint } : {}),
  });
}

/** Open discovery and link it causally to completed initialization. */
export function openMcpDiscoverSpan(
  connect: ReturnType<typeof observe.openSpan>,
  sourceId: string,
  implementation: McpPreparationObservation["implementation"],
  transport: McpToolSourceErrorContext,
): ReturnType<typeof observe.openSpan> {
  const discover = observe.openSpan({
    name: sourceId,
    primitive: "mcp.discover",
    attributes: {
      sourceKind: "mcp",
      sourceId,
      serverId: sourceId,
      sourceSessionId: `mcp:${connect.spanId}`,
      implementation,
      connectSpanId: connect.spanId,
      ...(transport.transportKind
        ? { transport: transport.transportKind }
        : {}),
      ...(transport.endpoint ? { endpoint: transport.endpoint } : {}),
    },
    definitionRefs: [mcpServerDefinitionRef(sourceId)],
  });
  discover.withContext(() => {
    observe.edge({
      edgeType: "caused",
      from: { kind: "span", id: connect.spanId },
      to: { kind: "span", id: discover.spanId },
    });
  });
  return discover;
}

/** Capture the completed preparation identity used by tools and cleanup. */
export function mcpPreparationObservation(options: {
  readonly sourceId: string;
  readonly implementation: McpPreparationObservation["implementation"];
  readonly connect: ReturnType<typeof observe.openSpan>;
  readonly discover: ReturnType<typeof observe.openSpan>;
  readonly transport: McpToolSourceErrorContext;
}): McpPreparationObservation {
  let cleanupContext!: ReturnType<typeof observe.captureContext>;
  options.discover.withContext(() => {
    cleanupContext = observe.captureContext();
  });
  return Object.freeze({
    ...options,
    sourceSessionId: `mcp:${options.connect.spanId}`,
    cleanupContext,
  });
}

/** Attach MCP origin to a normal materialized tool without changing its shape. */
export function withMcpToolProvenance<TTool extends object>(
  tool: TTool,
  metadata: McpDiscoveredToolMetadata,
  preparation: McpPreparationObservation,
): TTool {
  return withToolSourceProvenance(tool, {
    attributes: {
      sourceKind: "mcp",
      sourceId: preparation.sourceId,
      serverId: metadata.serverId,
      sourceSessionId: preparation.sourceSessionId,
      implementation: preparation.implementation,
      connectSpanId: preparation.connect.spanId,
      discoverSpanId: preparation.discover.spanId,
      ...(preparation.transport.transportKind
        ? { transport: preparation.transport.transportKind }
        : {}),
      remoteName: metadata.remoteName,
      exposedName: metadata.exposedName,
      inputSchemaFingerprint: metadata.inputSchemaFingerprint,
      ...(metadata.outputSchemaFingerprint
        ? { outputSchemaFingerprint: metadata.outputSchemaFingerprint }
        : {}),
      toolListFingerprint: metadata.toolListFingerprint,
      mcpErrorState: "none",
    },
    definitionRefs: [
      mcpServerDefinitionRef(metadata.serverId),
      toolDefinitionRef(metadata.exposedName),
    ],
    causedBySpanIds: [preparation.discover.spanId],
    errorAttributes: { mcpErrorState: "error" },
    resultPreview: mcpResultPreview,
  });
}

/** Attach the late cleanup event that Core emits after bounded close. */
export function withMcpSessionProvenance<TSession extends ToolSourceSession>(
  session: TSession,
  preparation: McpPreparationObservation,
): TSession {
  return withToolSourceSessionProvenance(session, {
    cleanupEvent: {
      name: "mcp.cleanup",
      context: preparation.cleanupContext,
      attributes: {
        sourceKind: "mcp",
        sourceId: preparation.sourceId,
        serverId: preparation.sourceId,
        sourceSessionId: preparation.sourceSessionId,
        implementation: preparation.implementation,
        connectSpanId: preparation.connect.spanId,
        discoverSpanId: preparation.discover.spanId,
      },
      errorCategory: () => "mcp-close",
    },
  });
}

/** Remove protocol-private and binary values before Core captures evidence. */
function mcpResultPreview(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return key === "data" || key === "blob"
      ? { omitted: "binary", encodedCharacters: value.length }
      : value;
  }
  if (ArrayBuffer.isView(value)) {
    return { omitted: "binary", sizeBytes: value.byteLength };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => mcpResultPreview(entry));
  }
  if (typeof value !== "object" || value === null) return value;

  const projected: Record<string, unknown> = {};
  for (const [entryKey, entry] of Object.entries(value)) {
    if (entryKey === "_meta") continue;
    projected[entryKey] = mcpResultPreview(entry, entryKey);
  }
  return projected;
}
