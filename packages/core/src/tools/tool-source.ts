/**
 * Provider-neutral contracts for tools discovered at execution time.
 *
 * Tool source definitions are inert prompt entries. An execution dialect owns
 * the source-specific connection and discovery mechanics and returns ordinary
 * Crux tools for the existing lifecycle to wrap.
 *
 * @module
 */

/** Brand applied to tool sources created by integration packages. */
export const TOOL_SOURCE: unique symbol = Symbol.for("crux.toolSource");

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
