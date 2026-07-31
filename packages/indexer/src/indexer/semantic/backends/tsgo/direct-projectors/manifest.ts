import type {
  InjectionUseFacts,
  ProjectDefinitionKind,
  ProjectSourceRef,
  ProjectRelation,
  ProjectSourceRefRole,
} from "@use-crux/core/project-index";
import { semanticPrimitiveCallNames } from "../../../semantic-call-names";
import { semanticStorageCallNames } from "../../../storage-model";
import { nativeDirectAgentPrimitiveManifest } from "./agent-manifest";
import { nativeDirectRoutingPrimitiveManifest } from "./routing-manifest";

export type NativeDirectDefinitionKind = ProjectDefinitionKind;
export type NativeDirectSchemaMetadataKey =
  | "schema"
  | "inputSchema"
  | "outputSchema";

export interface NativeDirectSchemaSpec {
  readonly property: string;
  readonly metadataKey: NativeDirectSchemaMetadataKey;
}

export type NativeDirectRelationOriginSpec =
  | {
      readonly kind: "owner";
    }
  | {
      readonly kind: "indexedOwnerChild";
      readonly segment: string;
    };

export type NativeDirectDependencyFactSpec =
  | {
      readonly kind: "injectionUseEntries";
      readonly metadataKey: "useEntries";
      readonly relationHint: NonNullable<InjectionUseFacts["relationHint"]>;
      readonly conditionality: NonNullable<InjectionUseFacts["conditionality"]>;
      readonly via: NonNullable<InjectionUseFacts["via"]>;
    }
  | {
      readonly kind: "injectionToolMap";
      readonly metadataKey: "tools";
    };

/**
 * Declares the accepted definition kind or kinds for a local identifier
 * dependency without widening every dependency spec to a loose array.
 */
type NativeDirectIdentifierDependencyTargetSpec =
  | {
      readonly targetKind: NativeDirectDefinitionKind;
      readonly targetKinds?: never;
    }
  | {
      readonly targetKind?: never;
      readonly targetKinds: readonly NativeDirectDefinitionKind[];
    };

export type NativeDirectIdentifierDependencySpec = {
  readonly kind: "identifierProperty";
  readonly property: string;
  readonly relationType: ProjectRelation["type"];
  readonly relationOrigin: NativeDirectRelationOriginSpec;
} & NativeDirectIdentifierDependencyTargetSpec;

export interface NativeDirectArrayDependencySpec {
  readonly kind: "arrayIdentifier";
  readonly property: string;
  readonly targetKind: NativeDirectDefinitionKind;
  readonly relationType: ProjectRelation["type"];
  readonly relationOrigin: NativeDirectRelationOriginSpec;
  readonly fact: Extract<
    NativeDirectDependencyFactSpec,
    { readonly kind: "injectionUseEntries" }
  >;
}

export interface NativeDirectObjectDependencySpec {
  readonly kind: "objectShorthand";
  readonly property: string;
  readonly targetKind: NativeDirectDefinitionKind;
  readonly relationType: ProjectRelation["type"];
  readonly relationOrigin: NativeDirectRelationOriginSpec;
  readonly fact?: Extract<
    NativeDirectDependencyFactSpec,
    { readonly kind: "injectionToolMap" }
  >;
  readonly sourceRef: {
    readonly role: ProjectSourceRefRole;
    readonly property: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  };
}

export interface NativeDirectStaticIdArrayDependencySpec {
  readonly kind: "staticIdArray";
  readonly property: string;
  readonly targetKind: NativeDirectDefinitionKind;
  readonly relationType: ProjectRelation["type"];
  readonly relationOrigin: NativeDirectRelationOriginSpec;
}

/** Statically known MCP allowlist edges emitted without fabricating tools. */
export interface NativeDirectMcpExpectedToolsDependencySpec {
  readonly kind: "mcpExpectedTools";
  readonly property: "tools";
  readonly relationType: "mcp.server.provides_tool";
  readonly relationOrigin: Extract<
    NativeDirectRelationOriginSpec,
    { readonly kind: "owner" }
  >;
}

export type NativeDirectDependencySpec =
  | NativeDirectIdentifierDependencySpec
  | NativeDirectArrayDependencySpec
  | NativeDirectObjectDependencySpec
  | NativeDirectStaticIdArrayDependencySpec
  | NativeDirectMcpExpectedToolsDependencySpec;

export interface NativeDirectPrimitiveSpec {
  readonly callName: string;
  readonly definitionKind: NativeDirectDefinitionKind;
  readonly nameProperties: readonly string[];
  readonly schema: readonly NativeDirectSchemaSpec[];
  readonly sourceRefs: readonly NativeDirectSourceRefSpec[];
  /** Structured prompt-text properties projected through the shared reachability model. */
  readonly promptText?: readonly NativeDirectPromptTextSpec[];
  readonly emitDefinition: "always" | "withMetadata";
  readonly dependencies: readonly NativeDirectDependencySpec[];
  /** Callback property whose `RouteArgs` context must be projected on the parent. */
  readonly routingContext?: {
    readonly callbackProperty: "classify" | "seed";
  };
}

export interface NativeDirectPromptTextSpec {
  readonly property: "system" | "prompt";
  readonly role: "system" | "prompt";
}

export interface NativeDirectSourceRefSpec {
  readonly property: string;
  readonly role: ProjectSourceRefRole;
  readonly metadata?: ProjectSourceRef["metadata"];
}

function nativeDirectToolPrimitive(
  callName: "tool" | "createTool",
): NativeDirectPrimitiveSpec {
  return {
    callName,
    definitionKind: "tool",
    nameProperties: ["name", "title"],
    emitDefinition: "withMetadata",
    schema: [
      { property: "input", metadataKey: "inputSchema" },
      { property: "parameters", metadataKey: "inputSchema" },
      { property: "output", metadataKey: "outputSchema" },
    ],
    sourceRefs: [
      { property: "execute", role: "execute" },
      { property: "run", role: "callback" },
      { property: "handler", role: "handler" },
    ],
    dependencies: [],
  };
}

/**
 * Internal manifest for first-party source shapes that can be projected
 * directly from TypeScript-Go AST evidence.
 *
 * This is deliberately data-only: it describes direct call names, definition
 * identity fields, schema fields, and local dependency relations. Anything not
 * represented here must route through the native shared semantic analyzer.
 */
export const nativeDirectPrimitiveManifest = [
  ...nativeDirectRoutingPrimitiveManifest,
  ...nativeDirectAgentPrimitiveManifest,
  {
    callName: "thread",
    definitionKind: "thread",
    nameProperties: ["id"],
    emitDefinition: "always",
    schema: [],
    sourceRefs: [],
    dependencies: [],
  },
  {
    callName: "mcp",
    definitionKind: "mcp.server",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [],
    dependencies: [
      {
        kind: "mcpExpectedTools",
        property: "tools",
        relationType: "mcp.server.provides_tool",
        relationOrigin: { kind: "owner" },
      },
    ],
  },
  {
    callName: "context",
    definitionKind: "context",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [{ property: "schema", metadataKey: "schema" }],
    sourceRefs: [
      { property: "system", role: "system", metadata: { fragment: true } },
      { property: "resolve", role: "resolver" },
      { property: "render", role: "callback" },
      { property: "handler", role: "handler" },
      { property: "when", role: "policy" },
    ],
    promptText: [{ property: "system", role: "system" }],
    dependencies: [
      {
        kind: "arrayIdentifier",
        property: "use",
        targetKind: "context",
        relationType: "context.uses_context",
        relationOrigin: { kind: "indexedOwnerChild", segment: "use" },
        fact: {
          kind: "injectionUseEntries",
          metadataKey: "useEntries",
          relationHint: "context",
          conditionality: "always",
          via: "direct",
        },
      },
      {
        kind: "arrayIdentifier",
        property: "use",
        targetKind: "thread",
        relationType: "context.uses_thread",
        relationOrigin: { kind: "indexedOwnerChild", segment: "use" },
        fact: {
          kind: "injectionUseEntries",
          metadataKey: "useEntries",
          relationHint: "thread",
          conditionality: "always",
          via: "direct",
        },
      },
      {
        kind: "arrayIdentifier",
        property: "use",
        targetKind: "mcp.server",
        relationType: "context.uses_mcp_server",
        relationOrigin: { kind: "indexedOwnerChild", segment: "use" },
        fact: {
          kind: "injectionUseEntries",
          metadataKey: "useEntries",
          relationHint: "unknown",
          conditionality: "always",
          via: "direct",
        },
      },
      {
        kind: "objectShorthand",
        property: "tools",
        targetKind: "tool",
        relationType: "context.uses_tool",
        relationOrigin: { kind: "owner" },
        fact: { kind: "injectionToolMap", metadataKey: "tools" },
        sourceRef: {
          role: "config",
          property: "tools",
          metadata: { toolMapContributor: "property" },
        },
      },
    ],
  },
  nativeDirectToolPrimitive("tool"),
  nativeDirectToolPrimitive("createTool"),
  {
    callName: "prompt",
    definitionKind: "prompt",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [
      { property: "input", metadataKey: "inputSchema" },
      { property: "output", metadataKey: "outputSchema" },
    ],
    sourceRefs: [
      { property: "system", role: "system", metadata: { fragment: true } },
      { property: "prompt", role: "prompt" },
    ],
    promptText: [
      { property: "system", role: "system" },
      { property: "prompt", role: "prompt" },
    ],
    dependencies: [
      {
        kind: "arrayIdentifier",
        property: "use",
        targetKind: "context",
        relationType: "prompt.uses_context",
        relationOrigin: { kind: "indexedOwnerChild", segment: "use" },
        fact: {
          kind: "injectionUseEntries",
          metadataKey: "useEntries",
          relationHint: "context",
          conditionality: "always",
          via: "direct",
        },
      },
      {
        kind: "arrayIdentifier",
        property: "use",
        targetKind: "thread",
        relationType: "prompt.uses_thread",
        relationOrigin: { kind: "indexedOwnerChild", segment: "use" },
        fact: {
          kind: "injectionUseEntries",
          metadataKey: "useEntries",
          relationHint: "thread",
          conditionality: "always",
          via: "direct",
        },
      },
      {
        kind: "arrayIdentifier",
        property: "use",
        targetKind: "mcp.server",
        relationType: "prompt.uses_mcp_server",
        relationOrigin: { kind: "indexedOwnerChild", segment: "use" },
        fact: {
          kind: "injectionUseEntries",
          metadataKey: "useEntries",
          relationHint: "unknown",
          conditionality: "always",
          via: "direct",
        },
      },
      {
        kind: "objectShorthand",
        property: "tools",
        targetKind: "tool",
        relationType: "prompt.uses_tool",
        relationOrigin: { kind: "owner" },
        fact: { kind: "injectionToolMap", metadataKey: "tools" },
        sourceRef: {
          role: "config",
          property: "tools",
          metadata: { toolMapContributor: "property" },
        },
      },
    ],
  },
] as const satisfies readonly NativeDirectPrimitiveSpec[];

export const nativeDirectPrimitiveCallNames = nativeDirectPrimitiveManifest.map(
  (primitive) => primitive.callName,
);

const nativeDirectPrimitiveCallNameSet: ReadonlySet<string> = new Set([
  ...nativeDirectPrimitiveCallNames,
  ...semanticStorageCallNames,
]);
const semanticPrimitiveCallNameSet: ReadonlySet<string> = new Set(
  semanticPrimitiveCallNames,
);
const nativeDirectPrimitiveByCallName: ReadonlyMap<
  string,
  NativeDirectPrimitiveSpec
> = new Map(
  nativeDirectPrimitiveManifest.map((primitive) => [
    primitive.callName,
    primitive,
  ]),
);

export function nativeDirectPrimitiveForCallName(
  callName: string,
): NativeDirectPrimitiveSpec | undefined {
  return nativeDirectPrimitiveByCallName.get(callName);
}

export function isSemanticPrimitiveCallName(callName: string): boolean {
  return semanticPrimitiveCallNameSet.has(callName);
}

export function isNativeDirectPrimitiveCallName(callName: string): boolean {
  return nativeDirectPrimitiveCallNameSet.has(callName);
}

export function isNativeDirectCandidateCallSet(
  callNames: readonly string[],
): boolean {
  return (
    callNames.some(isNativeDirectPrimitiveCallName) &&
    callNames.every(
      (callName) =>
        !isSemanticPrimitiveCallName(callName) ||
        isNativeDirectPrimitiveCallName(callName),
    )
  );
}
