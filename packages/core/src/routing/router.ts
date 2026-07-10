/**
 * Classifier-based model routing.
 *
 * A router is an inert, frozen value that can be passed as a model option.
 * The resolver calls `classify({ input, context })` at execution time, then
 * resolves the selected route recursively so routers can compose with every
 * other routing primitive.
 *
 * @module
 */

import type {
  CallProfile,
  ComposedCtx,
  ComposedStream,
  RouteArgs,
  RoutingPhantom,
  BoundOf,
  InOf,
} from "./types";

/** A raw model, call profile, or routing wrapper accepted in route maps. */
export type RouterRouteTarget = unknown | CallProfile<unknown>;

/** Configuration for a classifier-based model router. */
export interface RouterConfig<
  TRoutes extends string,
  Routes extends Record<string, RouterRouteTarget>,
  TCtx extends object = object,
  TIn = never,
> {
  /** Stable id used to join authored index definitions with routing spans. */
  readonly id?: string;
  /** Human-readable description for index and devtools surfaces. */
  readonly description?: string;
  /** Classify the call into one route key. Unknown keys fall back to `default`. */
  readonly classify: (
    args: RouteArgs<TCtx, TIn>,
  ) => TRoutes | "default" | Promise<TRoutes | "default">;
  /** Map of route keys to models. Must include every classify key and `default`. */
  readonly routes: Routes &
    Record<TRoutes | "default", RouterRouteTarget> &
    (string extends TRoutes
      ? ["classify must return specific route keys, not string"]
      : unknown);
}

/** A router model wrapper recognized by adapters via {@link isRouter}. */
export interface RouterModel<
  TRoutes extends string = string,
  Routes extends Record<string, RouterRouteTarget> = Record<string, RouterRouteTarget>,
  TCtx extends object = object,
  TIn = never,
> extends RoutingPhantom<
    TIn | InOf<Routes[keyof Routes]>,
    ComposedCtx<TCtx, Routes[keyof Routes]>,
    ComposedStream<Routes[keyof Routes]>,
    BoundOf<Routes[keyof Routes]>,
    Extract<keyof Routes, string>
  > {
  readonly _tag: "crux.router";
  readonly config: RouterConfig<TRoutes, Routes, TCtx, TIn>;
}

/** Base router shape for callers that only need wrapper recognition. */
export type AnyRouterModel<M = unknown> = RouterModel<string, Record<string, M>>;

/**
 * Create a classifier-based router.
 *
 * @example
 * ```ts
 * const supportModel = router({
 *   classify: ({ context }: RouteArgs<{ tier: 'free' | 'pro' }>) =>
 *     context.tier === 'pro' ? 'deep' : 'fast',
 *   routes: {
 *     fast: gpt5mini,
 *     deep: { model: opus, maxTokens: 4000 },
 *     default: gpt5mini,
 *   },
 * })
 * ```
 */
export function router<
  TRoutes extends string,
  Routes extends Record<string, RouterRouteTarget>,
  TCtx extends object = object,
  TIn = never,
>(config: RouterConfig<TRoutes, Routes, TCtx, TIn>): RouterModel<TRoutes, Routes, TCtx, TIn> {
  return Object.freeze({
    _tag: "crux.router" as const,
    config,
    __phantom: undefined as unknown as RouterModel<TRoutes, Routes, TCtx, TIn>["__phantom"],
  });
}

/** Type guard for router wrappers. */
export function isRouter(model: unknown): model is RouterModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === "object" &&
    "_tag" in model &&
    (model as { _tag: unknown })._tag === "crux.router"
  );
}
