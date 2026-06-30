/**
 * Convex runtime bridge for Crux.
 *
 * The bridge owns the host/runtime side of `@use-crux/convex`: request-scoped
 * storage creation, ambient runtime binding, namespace defaults, and the
 * devtools HTTP bridge. Convex Agent integration layers on top of this module
 * instead of being part of the runtime boundary itself.
 *
 * @module
 */

import type { Crux } from '@use-crux/core'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import { setup as setupBridge } from './bridge'
import type { CruxConvexBridgeHttpRouter, CruxConvexBridgeSetupOptions } from './bridge'
import {
  assertConvexCtxPort,
  createCruxConvexStorageResolver,
  type CruxConvexProfileStorageOptions,
} from './profile-store'
import {
  runWithConvexCruxRuntime,
  type ConvexCruxRuntime,
  type ConvexMemoryNamespace,
  type ConvexRuntimeTarget,
} from './runtime'
import type { ComponentApi } from './src/component/_generated/component'
import type { ConvexCtxPort } from './store'

/** HTTP bridge options accepted by `ConvexRuntimeBridge.bridge()`. */
export type ConvexRuntimeBridgeSetupOptions = Omit<CruxConvexBridgeSetupOptions, 'component' | 'storage'>

/** Scope passed to `ConvexRuntimeBridge.run()`. */
export interface ConvexRunScope<TCtx extends ConvexCtxPort, TTarget extends ConvexRuntimeTarget> {
  /** Convex ctx for the current request. */
  readonly ctx: TCtx
  /** Optional runtime target for namespace and tool-call metadata. */
  readonly target?: TTarget
  /** Request-scoped Crux storage created by the bridge. */
  readonly storage: Storage
  /** Convenience record store from the request-scoped storage bundle. */
  readonly records: RecordStore
  /** Active runtime object bound for mirrored `@use-crux/convex/*` helpers. */
  readonly runtime: ConvexCruxRuntime<TCtx, TTarget>
}

/** Reusable host/runtime bridge for a Convex-installed Crux component. */
export interface ConvexRuntimeBridge<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /**
   * Create the request-scoped Crux storage using the bridge defaults.
   *
   * Returns a promise only when a custom `storage.create` override is async.
   */
  storage(ctx: TCtx): Storage | Promise<Storage>
  /**
   * Run lower-level Crux work with the Convex runtime bound.
   *
   * Memory, tools, namespace resolution, and `convexRuntimeRecords` all read the
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
   * Storage options for the request-scoped default storage.
   *
   * This is the preferred home for vector index/cache options and custom store
   * factory overrides.
   */
  readonly storage?: CruxConvexProfileStorageOptions<TCtx>
}

/**
 * Create the host/runtime bridge for Crux inside Convex.
 *
 * Use this when an app needs request-scoped Crux runtime behavior without
 * adopting the higher-level profile-backed Convex Agent helper. `createCruxConvex()`
 * delegates its runtime, storage, and bridge methods to this function.
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
 * await runtime.run(ctx, { threadId }, async ({ records }) => {
 *   await records.put(`blackboard:${threadId}`, { status: 'ready' })
 * })
 * ```
 */
export function createConvexRuntimeBridge<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  options: CreateConvexRuntimeBridgeOptions<TCtx>,
): ConvexRuntimeBridge<TCtx> {
  const storageForCtx = createCruxConvexStorageResolver<TCtx>({
    component: options.component,
    vectorIndexName: options.storage?.vectorIndexName,
    semanticCache: options.storage?.semanticCache,
    create: options.storage?.create,
  })

  function runtimeFor<TTarget extends ConvexRuntimeTarget>(
    ctx: TCtx,
    target: TTarget | undefined,
    storage: Storage,
  ): ConvexCruxRuntime<TCtx, TTarget> {
    return {
      ctx,
      component: options.component,
      storage,
      records: storage.records,
      target,
      namespace: options.namespace,
    }
  }

  return Object.freeze({
    storage(ctx: TCtx): Storage | Promise<Storage> {
      return storageForCtx(ctx)
    },
    async run<TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget, TResult = unknown>(
      ctx: TCtx,
      target: TTarget | undefined,
      fn: (scope: ConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
    ): Promise<Awaited<TResult>> {
      const storage = await storageForCtx(ctx)
      const runtime = runtimeFor(ctx, target, storage)
      return await runWithConvexCruxRuntime(runtime, () =>
        fn({
          ctx,
          target,
          storage,
          records: storage.records,
          runtime,
        }),
      )
    },
    bridge(http: CruxConvexBridgeHttpRouter, crux: Crux, bridgeOptions?: ConvexRuntimeBridgeSetupOptions): void {
      setupBridge(http, crux, {
        ...bridgeOptions,
        storage: (ctx) => {
          assertConvexCtxPort(ctx)
          return storageForCtx(ctx as TCtx)
        },
      })
    },
  })
}
