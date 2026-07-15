import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { withToolSourceReplayIdentity } from "@use-crux/core/tools";

import type { McpToolSelection } from "../index";
import { canonicalFingerprint } from "./canonical";
import { mcpApprovalReplayIdentity } from "./approval-replay";
import {
  McpToolSourceError,
  mcpToolSourceError,
  type McpToolSourceErrorContext,
} from "./errors";
import { assertMcpToolNames } from "./names";
import { mcpToolModelOutput, normalizeMcpToolResult } from "./result";
import { mcpInputSchema, mcpOutputSchema } from "./schema";
import type {
  McpDiscoveredToolMetadata,
  McpDiscoveryMetadata,
  McpMaterializedTool,
} from "./types";
import type { McpDiscoveryObservation } from "../observability";

export interface DiscoveredTools {
  readonly tools: Readonly<Record<string, McpMaterializedTool>>;
  readonly discovery: McpDiscoveryMetadata;
  readonly observation: McpDiscoveryObservation;
  readonly projected: readonly ProjectedMcpTool[];
}

export interface McpDiscoverySource {
  readonly id: string;
  readonly tools?: McpToolSelection;
}

const MAX_DISCOVERY_PAGES = 64;

/** One selected remote definition with its final name and stable metadata. */
export interface ProjectedMcpTool {
  readonly tool: Tool;
  readonly exposedName: string;
  readonly metadata: McpDiscoveredToolMetadata;
}

/** Discover all pages and project selected tools into deterministic Crux names. */
export async function discoverMcpTools(
  client: Client,
  source: McpDiscoverySource,
  errorContext: McpToolSourceErrorContext,
  abortSignal?: AbortSignal,
): Promise<DiscoveredTools> {
  const remoteTools: Tool[] = [];
  const requestedCursors = new Set<string>();
  let pageCount = 0;
  let cursor: string | undefined;

  do {
    if (pageCount >= MAX_DISCOVERY_PAGES) {
      throw new Error(
        `MCP tools/list exceeded the ${MAX_DISCOVERY_PAGES}-page discovery limit.`,
      );
    }
    pageCount += 1;
    if (cursor !== undefined) {
      if (requestedCursors.has(cursor)) {
        throw new Error(`MCP tools/list cursor loop detected at "${cursor}".`);
      }
      requestedCursors.add(cursor);
    }
    const page = await client.listTools(
      cursor === undefined ? undefined : { cursor },
      abortSignal ? { signal: abortSignal } : undefined,
    );
    remoteTools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  const projected = projectMcpTools(remoteTools, source, errorContext);
  const tools = Object.fromEntries(
    projected.map(({ tool, exposedName, metadata }) => [
      exposedName,
      materializedTool(client, tool, metadata, errorContext, abortSignal),
    ]),
  );

  return {
    tools,
    discovery: {
      toolListFingerprint:
        projected[0]?.metadata.toolListFingerprint ?? canonicalFingerprint([]),
      tools: projected.map(({ metadata }) => metadata),
    },
    observation: {
      pageCount,
      discoveredToolCount: remoteTools.length,
      selectedToolCount: projected.length,
      allowedToolCount: projected.length,
      deniedToolCount: remoteTools.length - projected.length,
    },
    projected,
  };
}

/** Apply shared filtering, portable naming, and identity to MCP definitions. */
export function projectMcpTools(
  remoteTools: readonly Tool[],
  source: McpDiscoverySource,
  errorContext: McpToolSourceErrorContext,
): readonly ProjectedMcpTool[] {
  const selected = remoteTools
    .filter((tool) => isSelected(tool.name, source.tools))
    .map((tool) => {
      assertSupportedExecution(tool, errorContext);
      const exposedName = `${source.tools?.prefix ?? ""}${tool.name}`;
      assertMcpToolNames(tool.name, exposedName, errorContext);
      return {
        tool,
        exposedName,
        inputSchemaFingerprint: canonicalFingerprint(tool.inputSchema),
        ...(tool.outputSchema
          ? {
              outputSchemaFingerprint: canonicalFingerprint(tool.outputSchema),
            }
          : {}),
      };
    })
    .sort((left, right) => compareNames(left.exposedName, right.exposedName));

  assertUniqueExposedNames(selected, errorContext);

  const toolListFingerprint = canonicalFingerprint(
    selected.map(({ tool, exposedName, ...fingerprints }) => ({
      remoteName: tool.name,
      exposedName,
      description: tool.description ?? "",
      annotations: tool.annotations ?? null,
      ...fingerprints,
    })),
  );
  const metadata = selected.map(
    ({ tool, exposedName, ...fingerprints }): McpDiscoveredToolMetadata => ({
      serverId: source.id,
      remoteName: tool.name,
      exposedName,
      ...fingerprints,
      toolListFingerprint,
      ...(tool.annotations
        ? { annotations: Object.freeze({ ...tool.annotations }) }
        : {}),
    }),
  );
  return selected.map(({ tool, exposedName }, index) => ({
    tool,
    exposedName,
    metadata: metadata[index]!,
  }));
}

function materializedTool(
  client: Client,
  tool: Tool,
  metadata: McpDiscoveredToolMetadata,
  errorContext: McpToolSourceErrorContext,
  materializationSignal?: AbortSignal,
): McpMaterializedTool {
  let parameters: ReturnType<typeof mcpInputSchema>;
  let outputSchema: ReturnType<typeof mcpOutputSchema> | undefined;
  try {
    parameters = mcpInputSchema(tool.inputSchema);
    outputSchema = tool.outputSchema
      ? mcpOutputSchema(tool.outputSchema)
      : undefined;
  } catch (error) {
    throw mcpToolSourceError("schema", errorContext, error);
  }
  return withToolSourceReplayIdentity(
    {
      description: tool.description ?? tool.name,
      parameters,
      async execute(input, options) {
        const signal = options.abortSignal ?? materializationSignal;
        const validatedInput = await parameters.parseAsync(input);
        const result = await client.callTool(
          { name: tool.name, arguments: validatedInput },
          undefined,
          signal ? { signal } : undefined,
        );
        if (outputSchema && result.structuredContent === undefined) {
          if (!result.isError) {
            throw new TypeError(
              `MCP tool "${tool.name}" advertised an output schema but returned no structured content.`,
            );
          }
        } else if (outputSchema && result.structuredContent !== undefined) {
          const validation = await outputSchema.safeParseAsync(
            result.structuredContent,
          );
          if (!validation.success) {
            throw new TypeError(
              `MCP tool "${tool.name}" returned structured content that does not match its output schema.`,
              { cause: validation.error },
            );
          }
        }
        return normalizeMcpToolResult(result);
      },
      toModelOutput: ({ output }) => mcpToolModelOutput(output),
      mcp: metadata,
    },
    mcpApprovalReplayIdentity(metadata),
  );
}

function assertSupportedExecution(
  tool: Tool,
  errorContext: McpToolSourceErrorContext,
): void {
  if (tool.execution?.taskSupport === "required") {
    throw new McpToolSourceError(
      "discover",
      errorContext,
      new Error(
        `MCP tool "${tool.name}" requires task-based execution, which Crux does not support.`,
      ),
    );
  }
}

function assertUniqueExposedNames(
  selected: readonly { readonly exposedName: string }[],
  errorContext: McpToolSourceErrorContext,
): void {
  for (let index = 1; index < selected.length; index += 1) {
    const exposedName = selected[index]!.exposedName;
    if (exposedName === selected[index - 1]!.exposedName) {
      throw new McpToolSourceError(
        "filter",
        errorContext,
        new Error(`Duplicate exposed MCP tool name "${exposedName}".`),
      );
    }
  }
}

function isSelected(
  name: string,
  selection: McpToolSelection | undefined,
): boolean {
  if (selection?.allow !== undefined) return selection.allow.includes(name);
  if (selection?.deny !== undefined) return !selection.deny.includes(name);
  return true;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
