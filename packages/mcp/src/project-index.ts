/**
 * Secret-safe runtime Project Index projection for MCP discovery.
 *
 * This module reports complete owner-scoped replacements. Local owns
 * lifecycle, tombstones, collision checks, and persistence.
 *
 * @module
 */

import {
  enqueueProjectIndexRuntimeUpdate,
  type ProjectIndexRuntimeUpdate,
} from "@use-crux/core/project-index/runtime";
import type { ProjectDefinition } from "@use-crux/core/project-index";
import {
  mcpServerDefinitionRef,
  toolDefinitionRef,
} from "@use-crux/core/observability";

import { canonicalFingerprint } from "./official-client/canonical";
import type { ProjectedMcpTool } from "./official-client/discovery";

/** Enqueue one complete, successful MCP discovery replacement. */
export function enqueueMcpDiscoveryUpdate(options: {
  readonly serverId: string;
  readonly sourceSessionId: string;
  readonly toolListFingerprint: string;
  readonly tools: readonly ProjectedMcpTool[];
  readonly observedAt?: string;
}): void {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const ownerId = mcpServerDefinitionRef(options.serverId).id;
  const definitions: ProjectDefinition[] = options.tools.map(
    ({ tool, exposedName, metadata }) => {
      const toolId = toolDefinitionRef(exposedName).id;
      return {
        id: toolId,
        kind: "tool" as const,
        name: exposedName,
        ...(tool.description ? { description: tool.description } : {}),
        fidelity: "resolved" as const,
        status: "active" as const,
        fingerprint: canonicalFingerprint({
          serverId: options.serverId,
          remoteName: tool.name,
          exposedName,
          inputSchemaFingerprint: metadata.inputSchemaFingerprint,
          outputSchemaFingerprint: metadata.outputSchemaFingerprint ?? null,
        }),
        metadata: {
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          facts: {
            kind: "tool",
            toolName: exposedName,
            mcp: {
              serverId: options.serverId,
              remoteName: tool.name,
              exposedName,
              provenance: "runtime-discovered",
            },
          },
          mcpDiscovery: {
            observedAt,
            toolListFingerprint: options.toolListFingerprint,
            inputSchemaFingerprint: metadata.inputSchemaFingerprint,
            ...(metadata.outputSchemaFingerprint
              ? { outputSchemaFingerprint: metadata.outputSchemaFingerprint }
              : {}),
            ...(tool.annotations
              ? { annotations: { untrusted: true, value: tool.annotations } }
              : {}),
          },
        },
      };
    },
  );
  const relations = definitions.map((definition) => ({
    id: `mcp.server.provides_tool:${ownerId}:${definition.id}`,
    type: "mcp.server.provides_tool",
    from: ownerId,
    to: definition.id,
    fidelity: "resolved" as const,
  }));

  enqueueProjectIndexRuntimeUpdate({
    schemaVersion: 1,
    operation: "replace",
    updateId: `${options.sourceSessionId}:discovery`,
    owner: { definitionId: ownerId, kind: "mcp.server" },
    observedAt,
    revision: options.toolListFingerprint,
    definitions,
    relations,
  } satisfies ProjectIndexRuntimeUpdate);
}

/** Enqueue secret-safe failure health without carrying partial child facts. */
export function enqueueMcpDiscoveryFailure(options: {
  readonly serverId: string;
  readonly updateId: string;
  readonly phase: string;
  readonly category: string;
  readonly observedAt?: string;
}): void {
  enqueueProjectIndexRuntimeUpdate({
    schemaVersion: 1,
    operation: "failure",
    updateId: options.updateId,
    owner: {
      definitionId: mcpServerDefinitionRef(options.serverId).id,
      kind: "mcp.server",
    },
    observedAt: options.observedAt ?? new Date().toISOString(),
    error: { phase: options.phase, category: options.category },
  } satisfies ProjectIndexRuntimeUpdate);
}
