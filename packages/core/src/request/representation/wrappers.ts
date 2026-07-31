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
  RepresentationSource,
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
  TSource extends RepresentationSource<z.ZodType>,
>(
  primary: TSource,
  ...alternatives: readonly [
    RepresentationSource<RepresentationSourceSchema<TSource>>,
    ...RepresentationSource<RepresentationSourceSchema<TSource>>[],
  ]
): PreferLadder<TSource> {
  return Object.freeze({
    _tag: "prefer",
    primary,
    alternatives: Object.freeze([...alternatives]),
  }) as PreferLadder<TSource>;
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
  TSource extends RepresentationSource,
>(
  source: SummarizableInput<TSource>,
  options: Readonly<SummarizableOptions> = {},
): SummarizableLadder<TSource> {
  return Object.freeze({
    _tag: "summarizable",
    source,
    options: Object.freeze({ ...options }),
  }) as SummarizableLadder<TSource>;
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
  TSource extends RepresentationSource,
>(
  source: OffloadableInput<TSource>,
  options?: Readonly<OffloadableOptions>,
): OffloadableLadder<TSource>;
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
    source,
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
  TSource extends RepresentationSource,
>(
  source: DroppableInput<TSource>,
): DroppableLadder<TSource> {
  return Object.freeze({
    _tag: "droppable",
    source,
  }) as DroppableLadder<TSource>;
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
  return (
    tag === "Context" ||
    tag === "prefer" ||
    tag === "summarizable"
  );
}
