/**
 * Provider-neutral contracts for tools discovered at execution time.
 *
 * Tool source definitions are inert prompt entries. An execution dialect owns
 * the source-specific connection and discovery mechanics and returns ordinary
 * Crux tools for the existing lifecycle to wrap.
 *
 * @module
 */

import type { JsonValue } from "../types/tool";

/** Brand applied to tool sources created by integration packages. */
export const TOOL_SOURCE: unique symbol = Symbol.for("crux.toolSource");

/** Internal symbol carrying a source-owned, secret-free replay identity. */
export const TOOL_SOURCE_REPLAY_IDENTITY: unique symbol = Symbol.for(
  "crux.toolSourceReplayIdentity",
);

/**
 * An inert source of tools that an execution dialect can materialize.
 *
 * Concrete packages extend this contract with frozen source configuration.
 * Application code should use those packages' factories rather than construct
 * this advanced boundary type directly.
 */
export interface ToolSource<out TKind extends string = string> {
  readonly [TOOL_SOURCE]: true;
  readonly _tag: "ToolSource";
  readonly id: string;
  readonly kind: TKind;
}

/** Per-invocation values available while a dialect materializes a source. */
export interface ToolSourceMaterializationContext {
  readonly runtimeContext: unknown;
  readonly abortSignal?: AbortSignal;
}

/** Tools and cleanup owned by one materialized source for one invocation. */
export interface ToolSourceSession {
  readonly tools: Readonly<Record<string, unknown>>;
  close(): void | Promise<void>;
}

/** Dialect-owned port that turns one inert source into an invocation session. */
export type ToolSourceMaterializer = (
  source: ToolSource,
  context: ToolSourceMaterializationContext,
) => ToolSourceSession | Promise<ToolSourceSession>;

/** Attach opaque, JSON-safe identity used to validate approval replay. */
export function withToolSourceReplayIdentity<TTool extends object>(
  tool: TTool,
  identity: JsonValue,
): TTool {
  return Object.assign(tool, { [TOOL_SOURCE_REPLAY_IDENTITY]: identity });
}

/** Read a materialized tool's opaque replay identity. @internal */
export function toolSourceReplayIdentity(tool: unknown): JsonValue | undefined {
  if (typeof tool !== "object" || tool === null) return undefined;
  return (tool as { readonly [TOOL_SOURCE_REPLAY_IDENTITY]?: JsonValue })[
    TOOL_SOURCE_REPLAY_IDENTITY
  ];
}

/** Return whether a value carries Core's tool-source brand. */
export function isToolSource(value: unknown): value is ToolSource {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [TOOL_SOURCE]?: unknown })[TOOL_SOURCE] === true
  );
}

/** Failure raised when a dialect cannot materialize an authored source kind. */
export class ToolSourceUnsupportedError extends Error {
  readonly code = "TOOL_SOURCE_UNSUPPORTED" as const;
  /** Literal source kind the dialect could not dispatch. */
  readonly sourceKind: string;
  /** Execution dialect selected for the invocation. */
  readonly dialect: string;

  constructor(source: ToolSource, dialect: string) {
    super(
      `Tool source kind "${source.kind}" is not supported by execution dialect "${dialect}".`,
    );
    this.name = "ToolSourceUnsupportedError";
    this.sourceKind = source.kind;
    this.dialect = dialect;
  }
}

/** Failure raised when materialized source tools collide during the merge. */
export class ToolSourceCollisionError extends Error {
  readonly code = "TOOL_SOURCE_COLLISION" as const;
  readonly phase = "merge" as const;
  /** Final exposed name that was contributed more than once. */
  readonly toolName: string;
  /** Source whose contribution conflicted with an earlier owner. */
  readonly sourceId: string;
  /** Human-readable identity of the earlier contribution. */
  readonly previousOwner: string;

  constructor(toolName: string, sourceId: string, previousOwner: string) {
    super(
      `Tool name collision for "${toolName}" between ${previousOwner} and tool source "${sourceId}". ` +
        "Configure an explicit source prefix.",
    );
    this.name = "ToolSourceCollisionError";
    this.toolName = toolName;
    this.sourceId = sourceId;
    this.previousOwner = previousOwner;
  }
}
