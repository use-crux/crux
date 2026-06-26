/**
 * Convex runtime bridge for Crux.
 *
 * The bridge owns the host/runtime side of `@use-crux/convex`: request-scoped
 * store creation, ambient runtime binding, namespace defaults, and the
 * devtools HTTP bridge. Convex Agent integration layers on top of this module
 * instead of being part of the runtime boundary itself.
 *
 * @module
 */

import type { Crux } from '@use-crux/core'
import type { CruxStore } from '@use-crux/core/store'
import { setup as setupBridge } from './bridge'
import type { CruxConvexBridgeHttpRouter, CruxConvexBridgeSetupOptions } from './bridge'
import { assertConvexCtxPort, createCruxConvexStoreResolver, type CruxConvexProfileStoreOptions } from './profile-store'
import {
  runWithConvexCruxRuntime,
  type ConvexCruxRuntime,
  type ConvexMemoryNamespace,
  type ConvexRuntimeTarget,
} from './runtime'
import type { ComponentApi } from './src/component/_generated/component'
import type { ConvexCtxPort } from './store'

/** HTTP bridge options accepted by `ConvexRuntimeBridge.bridge()`. */
export type ConvexRuntimeBridgeSetupOptions = Omit<CruxConvexBridgeSetupOptions, 'component' | 'store'>

/** Scope passed to `ConvexRuntimeBridge.run()`. */
export interface ConvexRunScope<TCtx extends ConvexCtxPort, TTarget extends ConvexRuntimeTarget> {
  /** Convex ctx for the current request. */
  readonly ctx: TCtx
  /** Optional runtime target for namespace and tool-call metadata. */
  readonly target?: TTarget
  /** Request-scoped Crux store created by the bridge. */
  readonly store: CruxStore
  /** Active runtime object bound for mirrored `@use-crux/convex/*` helpers. */
  readonly runtime: ConvexCruxRuntime<TCtx, TTarget>
}

/** Reusable host/runtime bridge for a Convex-installed Crux component. */
export interface ConvexRuntimeBridge<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /**
   * Create the request-scoped Crux store using the bridge defaults.
   *
   * Returns a promise only when a custom `store.create` override is async.
   */
  store(ctx: TCtx): CruxStore | Promise<CruxStore>
  /**
   * Run lower-level Crux work with the Convex runtime bound.
   *
   * Memory, tools, namespace resolution, and `convexRuntimeStore` all read the
   * active runtime while `fn` is executing.
   */
  run<TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget, TResult = unknown>(
    ctx: TCtx,
    target: TTarget | undefined,
    fn: (scope: ConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
  ): Promise<Awaited<TResult>>
  /** Register the HTTP devtools bridge using the same ctx-bound store path. */
  bridge(http: CruxConvexBridgeHttpRouter, crux: Crux, options?: ConvexRuntimeBridgeSetupOptions): void
}

/** Options for `createConvexRuntimeBridge()`. */
export interface CreateConvexRuntimeBridgeOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Crux persistence component installed from `@use-crux/convex/convex.config`. */
  readonly component: ComponentApi
  /**
   * Default namespace for memory and skill persistence.
   *
   * If omitted, the runtime falls back to `thread:${threadId}`,
   * `user:${userId}`, then `default`.
   */
  readonly namespace?: ConvexMemoryNamespace
  /**
   * Store options for the request-scoped default store.
   *
   * This is the preferred home for vector index/cache options and custom store
   * factory overrides.
   */
  readonly store?: CruxConvexProfileStoreOptions<TCtx>
}

/**
 * Create the host/runtime bridge for Crux inside Convex.
 *
 * Use this when an app needs request-scoped Crux runtime behavior without
 * adopting the higher-level profile-backed Convex Agent helper. `createCruxConvex()`
 * delegates its runtime, store, and bridge methods to this function.
 *
 * @param options - Component ref plus optional namespace/store defaults.
 * @returns A reusable Convex runtime bridge.
 *
 * @example
 * ```ts
 * const runtime = createConvexRuntimeBridge({
 *   component: components.crux,
 * })
 *
 * await runtime.run(ctx, { threadId }, async ({ store }) => {
 *   await store.set(`blackboard:${threadId}`, { status: 'ready' })
 * })
 * ```
 */
export function createConvexRuntimeBridge<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  options: CreateConvexRuntimeBridgeOptions<TCtx>,
): ConvexRuntimeBridge<TCtx> {
  const storeForCtx = createCruxConvexStoreResolver<TCtx>({
    component: options.component,
    vectorIndexName: options.store?.vectorIndexName,
    semanticCache: options.store?.semanticCache,
    create: options.store?.create,
  })

  function runtimeFor<TTarget extends ConvexRuntimeTarget>(
    ctx: TCtx,
    target: TTarget | undefined,
    store: CruxStore,
  ): ConvexCruxRuntime<TCtx, TTarget> {
    return {
      ctx,
      component: options.component,
      store,
      target,
      namespace: options.namespace,
    }
  }

  return Object.freeze({
    store(ctx: TCtx): CruxStore | Promise<CruxStore> {
      return storeForCtx(ctx)
    },
    async run<TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget, TResult = unknown>(
      ctx: TCtx,
      target: TTarget | undefined,
      fn: (scope: ConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
    ): Promise<Awaited<TResult>> {
      const store = await storeForCtx(ctx)
      const runtime = runtimeFor(ctx, target, store)
      return await runWithConvexCruxRuntime(runtime, () =>
        fn({
          ctx,
          target,
          store,
          runtime,
        }),
      )
    },
    bridge(http: CruxConvexBridgeHttpRouter, crux: Crux, bridgeOptions?: ConvexRuntimeBridgeSetupOptions): void {
      setupBridge(http, crux, {
        ...bridgeOptions,
        store: (ctx) => {
          assertConvexCtxPort(ctx)
          return storeForCtx(ctx as TCtx)
        },
      })
    },
  })
}
