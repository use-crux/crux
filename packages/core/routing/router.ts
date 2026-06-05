/**
 * Classifier-based model router — picks a model based on input classification.
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Configuration for a model router. */
export interface RouterConfig<TRoutes extends string, M, THints = undefined> {
  /** Stable id used to join authored catalog definitions with routing spans. */
  id?: string
  /** Human-readable description for catalog and devtools surfaces. */
  description?: string
  /** Classify the input to select a route. Receives optional typed hints from `.with()`. */
  classify: (input: Record<string, unknown>, hints?: THints) => TRoutes | 'default' | Promise<TRoutes | 'default'>
  /** Map of route keys to models. Must include a `default` key. */
  routes: Record<TRoutes | 'default', M>
}

/**
 * Base router shape — used by adapters that need to accept any RouterModel
 * without caring about specific route keys or hint types.
 */
export interface AnyRouterModel<M = unknown> {
  readonly _tag: 'crux.router'
  readonly config: { classify: Function; routes: Record<string, M> }
  readonly _hints: unknown
  readonly _forcedRoute: string | undefined
  select(key: string): AnyRouterModel<M>
}

/** A router model wrapper — recognized by adapters via `isRouter()`. */
export interface RouterModel<
  TRoutes extends string = string,
  M = unknown,
  THints = undefined,
> extends AnyRouterModel<M> {
  readonly _tag: 'crux.router'
  readonly config: RouterConfig<TRoutes, M, THints>
  readonly _hints: THints | undefined
  readonly _forcedRoute: (TRoutes | 'default') | undefined

  /** Force a specific route key — skips classify entirely. Returns new instance. */
  select(key: TRoutes | 'default'): RouterModel<TRoutes, M, THints>

  /** Pass typed hints to classify's 2nd parameter. Returns new instance. */
  with: THints extends undefined ? never : (hints: THints) => RouterModel<TRoutes, M, THints>
}

// ─────────────────────────────────────────────────────────────────
// router()
// ─────────────────────────────────────────────────────────────────

/**
 * Create a classifier-based model router.
 *
 * @example
 * ```ts
 * import { router } from '@crux/core/routing'
 *
 * const smartRouter = router({
 *   classify: (input) => input.tokens > 2000 ? 'complex' : 'simple',
 *   routes: {
 *     simple: haiku,
 *     complex: opus,
 *     default: sonnet,
 *   },
 * })
 *
 * generate(prompt, { model: smartRouter, input })
 * ```
 */
export function router<TRoutes extends string, M, THints = undefined>(
  config: RouterConfig<TRoutes, M, THints>,
): RouterModel<TRoutes, M, THints> {
  return createRouterModel(config, undefined, undefined)
}

// ─────────────────────────────────────────────────────────────────
// isRouter()
// ─────────────────────────────────────────────────────────────────

/** Type guard — returns `true` if the value is a `RouterModel` wrapper. */
export function isRouter(model: unknown): model is RouterModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === 'object' &&
    '_tag' in model &&
    (model as { _tag: unknown })._tag === 'crux.router'
  )
}

// ─────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────

function createRouterModel<TRoutes extends string, M, THints>(
  config: RouterConfig<TRoutes, M, THints>,
  hints: THints | undefined,
  forcedRoute: (TRoutes | 'default') | undefined,
): RouterModel<TRoutes, M, THints> {
  const model: RouterModel<TRoutes, M, THints> = Object.freeze({
    _tag: 'crux.router' as const,
    config,
    _hints: hints,
    _forcedRoute: forcedRoute,

    select(key: TRoutes | 'default') {
      return createRouterModel(config, hints, key)
    },

    with: ((newHints: THints) => {
      return createRouterModel(config, newHints, forcedRoute)
    }) as RouterModel<TRoutes, M, THints>['with'],
  })

  return model
}
