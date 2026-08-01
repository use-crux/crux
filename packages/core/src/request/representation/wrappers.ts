/**
 * Public constructors for request representation policy.
 *
 * @module
 */

import type { z } from "zod";
import type {
  DroppableInput,
  DroppableLadder,
  ForcedOffload,
  OffloadableInput,
  OffloadableLadder,
  OffloadableOptions,
  PreferLadder,
  NormalizedRepresentationSource,
  RepresentationContextSource,
  RepresentationSource,
  RepresentationSourceInput,
  RepresentationSourceSchema,
  SummarizableInput,
  SummarizableLadder,
  SummarizableOptions,
  ToolOutputOffloadPolicy,
} from "./ladder-types";

/**
 * Declare ordered exact authored alternatives for one canonical source.
 *
 * The primary owns identity, priority, and capabilities. Selecting an
 * alternative never mutates the primary or authorizes omission.
 *
 * @param primary - Canonical highest-fidelity source.
 * @param alternatives - Lower-fidelity exact sources in preference order.
 * @returns An inert authored representation ladder.
 *
 * @example
 * ```ts
 * use: [prefer(fullInstructions, compactInstructions)]
 * ```
 */
export function prefer<
  TSource extends RepresentationSourceInput<RepresentationSource<z.ZodType>>,
>(
  primary: TSource,
  ...alternatives: readonly [
    RepresentationSourceInput<RepresentationSourceSchema<NormalizedRepresentationSource<TSource>> extends z.ZodType
      ? RepresentationSource<RepresentationSourceSchema<NormalizedRepresentationSource<TSource>>>
      : never>,
    ...RepresentationSourceInput<RepresentationSourceSchema<NormalizedRepresentationSource<TSource>> extends z.ZodType
      ? RepresentationSource<RepresentationSourceSchema<NormalizedRepresentationSource<TSource>>>
      : never>[],
  ]
): PreferLadder<NormalizedRepresentationSource<TSource>> {
  return Object.freeze({
    _tag: "prefer",
    primary: normalizeSource(primary),
    alternatives: Object.freeze(alternatives.map(normalizeSource)),
  }) as PreferLadder<NormalizedRepresentationSource<TSource>>;
}

/**
 * Authorize a generated summary below exact authored representations.
 *
 * Construction is inert and never calls a model. Until summary artifact
 * support prepares this rung, selection fails with
 * `REPRESENTATION_UNAVAILABLE` instead of silently using the full source.
 *
 * @param source - Exact source, atomic source array, or authored ladder.
 * @param options - Summary policy retained for artifact preparation.
 * @returns An inert generated-summary ladder.
 *
 * @example
 * ```ts
 * use: [summarizable(productDocs)]
 * ```
 */
export function summarizable<
  TSource extends RepresentationSourceInput,
>(
  source: SummarizableInput<TSource>,
  options: Readonly<SummarizableOptions> = {},
): SummarizableLadder<NormalizedRepresentationSource<TSource>> {
  return Object.freeze({
    _tag: "summarizable",
    source: normalizeInput(source),
    options: Object.freeze({ ...options }),
  }) as SummarizableLadder<NormalizedRepresentationSource<TSource>>;
}

/**
 * Authorize an exact-recovery reference below exact or summarized content.
 *
 * Construction never publishes data. Until reference backing prepares this
 * rung, selection fails with `REPRESENTATION_UNAVAILABLE`.
 *
 * @param source - Source or non-terminal representation ladder.
 * @param options - Reference selection policy.
 * @returns An inert exact-recovery ladder.
 *
 * @example
 * ```ts
 * use: [offloadable(debugLogs, { aboveTokens: 4_000 })]
 * ```
 */
export function offloadable<
  TSource extends RepresentationSourceInput,
>(
  source: OffloadableInput<TSource>,
  options?: Readonly<OffloadableOptions>,
): OffloadableLadder<NormalizedRepresentationSource<TSource>>;
/**
 * Declare a Tool output reference policy for later execution support.
 *
 * @param options - Threshold policy without a source.
 * @returns An inert Tool output policy.
 */
export function offloadable(
  options: Readonly<OffloadableOptions>,
): ToolOutputOffloadPolicy;
export function offloadable(
  sourceOrOptions:
    | OffloadableInput<RepresentationSource>
    | Readonly<OffloadableOptions>,
  options: Readonly<OffloadableOptions> = {},
): OffloadableLadder | ToolOutputOffloadPolicy {
  const source = isRepresentationInput(sourceOrOptions)
    ? sourceOrOptions
    : undefined;
  if (!source) {
    const outputOptions = sourceOrOptions as Readonly<OffloadableOptions>;
    return Object.freeze({
      _tag: "offload-output",
      options: Object.freeze({ ...outputOptions }),
    });
  }
  return Object.freeze({
    _tag: "offloadable",
    source: normalizeInput(source),
    options: Object.freeze({ ...options }),
  }) as OffloadableLadder;
}

/**
 * Authorize complete omission after every smaller representation is exhausted.
 *
 * Omission removes both model-facing content and the primary source's owned
 * capabilities. It never swallows source resolution errors.
 *
 * @param source - Source or non-terminal representation ladder.
 * @returns A terminal omission ladder.
 *
 * @example
 * ```ts
 * use: [droppable(prefer(fullGuide, compactGuide))]
 * ```
 */
export function droppable<
  TSource extends RepresentationSourceInput,
>(
  source: DroppableInput<TSource>,
): DroppableLadder<NormalizedRepresentationSource<TSource>> {
  return Object.freeze({
    _tag: "droppable",
    source: normalizeInput(source),
  }) as DroppableLadder<NormalizedRepresentationSource<TSource>>;
}

/**
 * Require a value to use an exact-recovery reference representation.
 *
 * Construction never writes backing storage. Dispatch fails before provider
 * I/O until exact-recovery backing is available.
 *
 * @param value - Canonical value to retain outside model-facing content.
 * @returns A branded forced-reference value.
 *
 * @example
 * ```ts
 * return offload(toolResult)
 * ```
 */
export function offload<T>(value: T): ForcedOffload<T> {
  return Object.freeze({ _tag: "offload" as const, value });
}

function isRepresentationInput(
  value: unknown,
): value is OffloadableInput<RepresentationSource> {
  if (!value || typeof value !== "object") return false;
  const tag = (value as { readonly _tag?: unknown })._tag;
  assertValidContributorTag(value);
  return (
    tag === "Context" ||
    tag === "Contributor" ||
    tag === "prefer" ||
    tag === "summarizable" ||
    hasAsContext(value)
  );
}

function normalizeInput<TSource extends RepresentationSourceInput>(
  source: SummarizableInput<TSource> | OffloadableInput<TSource> | DroppableInput<TSource>,
): unknown {
  if (Array.isArray(source)) return Object.freeze(source.map(normalizeSource));
  return isSourceInput(source) ? normalizeSource(source) : source;
}

function normalizeSource<TSource extends RepresentationSourceInput>(
  source: TSource,
): NormalizedRepresentationSource<TSource> {
  assertValidContributorTag(source);
  if (isContext(source)) {
    return source as NormalizedRepresentationSource<TSource>;
  }
  // Non-context values without an asContext() adapter (such as already-wrapped
  // ladders reaching here through invalid nesting) pass through unchanged so
  // the ladder constructors reject them with their own diagnostics.
  return (
    hasAsContext(source) ? source.asContext() : source
  ) as NormalizedRepresentationSource<TSource>;
}

function isSourceInput(value: unknown): value is RepresentationSourceInput {
  assertValidContributorTag(value);
  return isContext(value) || isContributor(value) || hasAsContext(value);
}

function isContext(value: unknown): value is RepresentationSource {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { readonly _tag?: unknown })._tag === "Context"
  );
}

function isContributor(value: unknown): value is RepresentationSource {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { readonly _tag?: unknown })._tag === "Contributor" &&
    typeof (value as { readonly contribute?: unknown }).contribute === "function"
  );
}

function hasAsContext(value: unknown): value is RepresentationContextSource {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { readonly asContext?: unknown }).asContext === "function"
  );
}

function assertValidContributorTag(value: unknown): void {
  if (
    !!value &&
    typeof value === "object" &&
    (value as { readonly _tag?: unknown })._tag === "Contributor" &&
    typeof (value as { readonly contribute?: unknown }).contribute !== "function"
  ) {
    throw new TypeError(
      "Contributor representation source must include a callable contribute().",
    );
  }
}
