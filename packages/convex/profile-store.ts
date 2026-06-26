/**
 * Shared store construction for the Convex runtime profile.
 *
 * `createCruxConvex()`, standalone `convexAgent()`, and the HTTP bridge all
 * normalize through this module so component-backed defaults and custom store
 * overrides cannot drift.
 *
 * @module
 */

import type { CruxStore } from '@use-crux/core/store'
import type { ComponentApi } from './src/component/_generated/component'
import { cruxConvexStore, type ConvexCtxPort, type ConvexMemoryStoreConfig } from './store'

/** Semantic-cache store capability options. */
export type ConvexSemanticCacheOptions = ConvexMemoryStoreConfig['semanticCache']

/** Defaults provided to a custom profile store factory. */
export interface CruxConvexProfileStoreDefaults {
  /** Crux persistence component ref from `components.crux`. */
  readonly component: ComponentApi
  /** Vector index name used by the component-backed default store. */
  readonly vectorIndexName: string
  /** Semantic-cache metadata for the default store, when configured. */
  readonly semanticCache?: ConvexSemanticCacheOptions
  /**
   * Build the standard component-backed store for a ctx.
   *
   * Custom factories can call this to wrap, decorate, or selectively delegate
   * to the default store without duplicating component wiring.
   */
  createComponentStore(ctx: ConvexCtxPort): CruxStore
}

/** Optional advanced store override accepted by `createCruxConvex()`. */
export interface CruxConvexProfileStoreOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /**
   * Vector index name for the default component-backed store.
   *
   * @default 'by_embedding'
   */
  readonly vectorIndexName?: string
  /** Semantic-cache metadata for the default component-backed store. */
  readonly semanticCache?: ConvexSemanticCacheOptions
  /**
   * Replace or wrap the default component-backed store for this request.
   *
   * This is the single profile-level escape hatch for tests, migrations, and
   * alternate storage. Most apps should omit it and use the component-backed
   * default.
   */
  readonly create?: (ctx: TCtx, defaults: CruxConvexProfileStoreDefaults) => CruxStore | Promise<CruxStore>
}

interface CreateProfileStoreResolverOptions<TCtx extends ConvexCtxPort> extends CruxConvexProfileStoreOptions<TCtx> {
  readonly component: ComponentApi
}

/** Build the standard component-backed store from shared profile defaults. */
export function createDefaultConvexCruxStore<TCtx extends ConvexCtxPort>(
  ctx: TCtx,
  options: {
    readonly component: ComponentApi
    readonly vectorIndexName?: string
    readonly semanticCache?: ConvexSemanticCacheOptions
  },
): CruxStore {
  return cruxConvexStore({
    component: options.component,
    ctx,
    vectorIndexName: options.vectorIndexName,
    semanticCache: options.semanticCache,
  })
}

/** Assert an unknown value can be used as the minimal Convex ctx port. */
export function assertConvexCtxPort(ctx: unknown): asserts ctx is ConvexCtxPort {
  if (!isRecord(ctx) || typeof ctx.runQuery !== 'function' || typeof ctx.runMutation !== 'function') {
    throw new Error('A Convex ctx with runQuery() and runMutation() is required to create a Crux Convex store.')
  }
}

/**
 * Create a request-scoped store resolver for a profile.
 *
 * The returned function may be synchronous or asynchronous depending on the
 * custom `store.create` override. Callers that need to support both should
 * `await` the result.
 */
export function createCruxConvexStoreResolver<TCtx extends ConvexCtxPort>(
  options: CreateProfileStoreResolverOptions<TCtx>,
): (ctx: TCtx) => CruxStore | Promise<CruxStore> {
  const vectorIndexName = options.vectorIndexName ?? 'by_embedding'
  const defaults: CruxConvexProfileStoreDefaults = Object.freeze({
    component: options.component,
    vectorIndexName,
    ...(options.semanticCache === undefined ? {} : { semanticCache: options.semanticCache }),
    createComponentStore(ctx: ConvexCtxPort) {
      assertConvexCtxPort(ctx)
      return createDefaultConvexCruxStore(ctx, {
        component: options.component,
        vectorIndexName,
        semanticCache: options.semanticCache,
      })
    },
  })

  return (ctx) => {
    if (options.create) return options.create(ctx, defaults)
    return defaults.createComponentStore(ctx)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
