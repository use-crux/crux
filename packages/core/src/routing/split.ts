/**
 * Weighted deterministic split routing.
 *
 * `split()` selects one route by hashing a stable seed from the call context.
 * It is intended for canaries and experiments where the same session should
 * keep landing in the same bucket.
 *
 * @module
 */

import type {
  BoundOf,
  ComposedCtx,
  ComposedStream,
  InOf,
  RouteArgs,
  RoutingPhantom,
} from "./types";

/** One weighted split route. */
export interface SplitRoute<M = unknown> {
  /** Model or routing wrapper for this bucket. */
  readonly model: M;
  /** Relative bucket weight. Non-positive values are ignored at runtime. */
  readonly weight: number;
}

/** Configuration for a weighted split. */
export interface SplitConfig<
  Routes extends Record<string, SplitRoute>,
  TCtx extends object = object,
> {
  /** Stable id used to join authored index definitions with routing spans. */
  readonly id?: string;
  /** Human-readable description for index and devtools surfaces. */
  readonly description?: string;
  /** Stable seed source. The raw seed is never emitted to observability. */
  readonly seed: (args: RouteArgs<TCtx>) => string;
  /** Weighted route buckets. */
  readonly routes: Routes;
}

/** A split model wrapper recognized by adapters via {@link isSplit}. */
export interface SplitModel<
  Routes extends Record<string, SplitRoute> = Record<string, SplitRoute>,
  TCtx extends object = object,
> extends RoutingPhantom<
    InOf<Routes[keyof Routes]["model"]>,
    ComposedCtx<TCtx, Routes[keyof Routes]["model"]>,
    ComposedStream<Routes[keyof Routes]["model"]>,
    BoundOf<Routes[keyof Routes]["model"]>,
    Extract<keyof Routes, string>
  > {
  readonly _tag: "crux.split";
  readonly config: SplitConfig<Routes, TCtx>;
}

/**
 * Create a deterministic weighted split.
 *
 * @example
 * ```ts
 * const canary = split({
 *   seed: ({ context }: RouteArgs<{ sessionId: string }>) => context.sessionId,
 *   routes: {
 *     stable: { model: gpt4o, weight: 95 },
 *     canary: { model: gpt5mini, weight: 5 },
 *   },
 * })
 * ```
 */
export function split<
  Routes extends Record<string, SplitRoute>,
  TCtx extends object = object,
>(config: SplitConfig<Routes, TCtx>): SplitModel<Routes, TCtx> {
  return Object.freeze({
    _tag: "crux.split" as const,
    config,
    __phantom: undefined as unknown as SplitModel<Routes, TCtx>["__phantom"],
  });
}

/** Type guard for split wrappers. */
export function isSplit(model: unknown): model is SplitModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === "object" &&
    "_tag" in model &&
    (model as { _tag: unknown })._tag === "crux.split"
  );
}
