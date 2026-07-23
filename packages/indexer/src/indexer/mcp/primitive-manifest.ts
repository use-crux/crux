import type {
  McpServerFacts,
  McpToolSelectionFacts,
  McpTransportFacts,
  ProjectDefinition,
  ToolFacts,
} from "@use-crux/core/project-index";
import {
  facts,
  none,
  type ExtractContext,
  type IndexerExtension,
} from "../extensions";
import { hasMcpTransportResolver } from "./resolver-evidence";

export {
  authoredMcpPrimitiveManifest,
  mcpRelationDeclarations,
} from "./manifest";

/** Immutable first-party authored MCP primitive manifest. */
export const mcpPrimitiveManifest = Object.freeze({
  name: "@use-crux/indexer/crux-core-mcp",
  version: "1",
  extractors: [
    {
      name: "mcp.server",
      patterns: [
        {
          kind: "call" as const,
          name: "mcp",
          importFrom: ["@use-crux/mcp"],
          configArg: 0,
        },
      ],
      extract: extractMcpServer,
    },
  ],
  relations: [
    relation("prompt.uses_mcp_server", ["prompt"], ["mcp.server"]),
    relation("context.uses_mcp_server", ["context"], ["mcp.server"]),
    relation("mcp.server.provides_tool", ["mcp.server"], ["tool"]),
  ],
} satisfies IndexerExtension);

function extractMcpServer(ctx: ExtractContext) {
  const serverId = ctx.config?.string("id");
  if (!serverId) return none();
  const definitionId = `mcp.server:${ctx.source.safeId(serverId)}`;
  const definition = withoutSnippet(
    ctx.define.definition({
      variableName: ctx.source.variableName,
      id: definitionId,
      kind: "mcp.server",
      name: serverId,
      metadata: {
        ...(ctx.source.exported
          ? { exportName: ctx.source.variableName, exported: true }
          : {}),
        facts: {
          kind: "mcp.server",
          serverId,
          ...optional("transport", transportFacts(ctx)),
          ...optional("tools", selectionFacts(ctx)),
        } satisfies McpServerFacts,
      },
    }),
  );
  const expectedTools = partialExpectedTools(
    ctx,
    definition.definition,
    serverId,
  );
  return facts({
    definitions: [
      expectedTools.length > 0
        ? { ...definition, extraDefinitions: expectedTools }
        : definition,
    ],
    ...(expectedTools.length > 0
      ? {
          references: expectedTools.map((tool) => ({
            ...ctx.ref.id("mcp.server.provides_tool", tool.id),
            fromId: definitionId,
          })),
        }
      : {}),
  });
}

function transportFacts(ctx: ExtractContext): McpTransportFacts | undefined {
  const transport = ctx.config?.callObject("transport");
  if (transport?.name === "stdio") {
    return {
      kind: "stdio",
      ...optional(
        "executable",
        lexicalBasename(transport.config.string("command")),
      ),
    };
  }
  if (transport?.name === "streamableHttp") {
    const endpoint = safeHttpEndpoint(transport.config.string("url"));
    return { kind: "streamable-http", ...endpoint };
  }
  return hasMcpTransportResolver(ctx) ? { kind: "resolver" } : undefined;
}

function selectionFacts(
  ctx: ExtractContext,
): McpToolSelectionFacts | undefined {
  const tools = ctx.config?.object("tools");
  if (!tools) return undefined;
  const prefix = tools.string("prefix");
  const allow = knownStringArray(tools.json("allow"));
  if (allow) return { allow, ...optional("prefix", prefix) };
  const deny = knownStringArray(tools.json("deny"));
  if (deny) return { deny, ...optional("prefix", prefix) };
  return prefix === undefined ? undefined : { prefix };
}

function knownStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function partialExpectedTools(
  ctx: ExtractContext,
  server: ProjectDefinition,
  serverId: string,
): ProjectDefinition[] {
  const tools = ctx.config?.object("tools");
  if (!tools?.has("allow")) return [];
  const prefix = tools.string("prefix") ?? "";
  return tools.stringArray("allow").map((remoteName) => {
    const exposedName = `${prefix}${remoteName}`;
    const factsValue: ToolFacts = {
      kind: "tool",
      toolName: exposedName,
      mcp: {
        serverId,
        remoteName,
        exposedName,
        provenance: "authored-expected",
      },
    };
    return {
      id: `tool:${ctx.source.safeId(exposedName)}`,
      kind: "tool",
      name: exposedName,
      ...(server.source ? { source: server.source } : {}),
      fidelity: "partial",
      metadata: { facts: factsValue },
    };
  });
}

function safeHttpEndpoint(
  value: string | undefined,
): Pick<
  Extract<McpTransportFacts, { kind: "streamable-http" }>,
  "origin" | "pathname"
> {
  if (!value) return {};
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? { origin: url.origin, pathname: url.pathname }
      : {};
  } catch {
    return {};
  }
}

function lexicalBasename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
}

function optional<const K extends string, const V>(
  key: K,
  value: V | undefined,
): {} | { readonly [P in K]: V } {
  return value === undefined
    ? {}
    : ({ [key]: value } as { readonly [P in K]: V });
}

function withoutSnippet<
  T extends ReturnType<ExtractContext["define"]["definition"]>,
>(input: T): T {
  const { sourceSnippet: _sourceSnippet, ...definition } = input.definition;
  return { ...input, definition } as T;
}

function relation(
  type: string,
  fromKinds: readonly string[],
  toKinds: readonly string[],
) {
  return {
    type,
    fromKinds,
    toKinds,
    presentation: "both" as const,
    fidelity: "resolved" as const,
    runtimeJoin: true,
  };
}
