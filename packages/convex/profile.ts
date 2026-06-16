/**
 * Convex runtime profile for Crux.
 *
 * A profile owns the request-scoped Convex runtime binding for one app: Crux
 * component refs, default store creation, namespace defaults, high-level agent
 * construction, and devtools bridge setup.
 *
 * @module
 */

import type { Crux, ContextEntry, Prompt } from '@crux/core'
import type { CruxStore } from '@crux/core/store'
import type { z } from 'zod'
import { setup as setupBridge } from './bridge'
import type { CruxConvexBridgeHttpRouter, CruxConvexBridgeSetupOptions } from './bridge'
import { convexAgent as createConvexAgent } from './agent'
import type { ConvexAgentComponent, ConvexAgentConfig, CruxConvexAgent } from './agent'
import { assertConvexCtxPort, createCruxConvexStoreResolver, type CruxConvexProfileStoreOptions } from './profile-store'
import { runWithConvexCruxRuntime, type ConvexCruxRuntime, type ConvexRuntimeTarget } from './runtime'
import type { ComponentApi } from './src/component/_generated/component'
import type { ConvexCtxPort, ConvexMemoryStoreConfig } from './store'

/** Convex components required by the Crux profile. */
export interface CruxConvexComponents {
  /** Crux persistence component installed from `@crux/convex/convex.config`. */
  crux: ComponentApi
  /** Convex Agent component installed from `@convex-dev/agent/convex.config`. */
  agent: ConvexAgentComponent
}

/** Config accepted by a profile-created Convex agent. */
export type CruxConvexProfileAgentConfig<
  TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>,
> = Omit<ConvexAgentConfig<TPrompt>, 'components' | 'store'>

/** Scope passed to `CruxConvexProfile.run()`. */
export interface CruxConvexRunScope<TCtx extends ConvexCtxPort, TTarget extends ConvexRuntimeTarget> {
  /** Convex ctx for the current request. */
  readonly ctx: TCtx
  /** Optional runtime target for namespace and tool-call metadata. */
  readonly target?: TTarget
  /** Request-scoped Crux store created by the profile. */
  readonly store: CruxStore
  /** Active runtime object bound for mirrored `@crux/convex/*` helpers. */
  readonly runtime: ConvexCruxRuntime<TCtx, TTarget>
}

/** Reusable Convex runtime profile created by `createCruxConvex()`. */
export interface CruxConvexProfile<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Component refs captured by the profile. */
  readonly components: CruxConvexComponents
  /**
   * Create the request-scoped Crux store using the profile defaults.
   *
   * Returns a promise only when a custom `store.create` override is async.
   */
  store(ctx: TCtx): CruxStore | Promise<CruxStore>
  /**
   * Run lower-level Crux work with the Convex runtime bound.
   *
   * Memory, tools, namespace resolution, and `convexRuntimeStore` all read the
   * active profile runtime while `fn` is executing.
   */
  run<TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget, TResult = unknown>(
    ctx: TCtx,
    target: TTarget | undefined,
    fn: (scope: CruxConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
  ): Promise<Awaited<TResult>>
  /**
   * Compatibility alias for older low-level integrations.
   *
   * Prefer `run()` for new code because it exposes the bound store/runtime
   * scope directly and supports async custom store factories cleanly.
   */
  withRuntime<R, TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget>(
    ctx: TCtx,
    target: TTarget | undefined,
    fn: () => R,
  ): R | Promise<Awaited<R>>
  /** Create a Convex Agent wrapper using this profile's components and store. */
  convexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>>(
    config: CruxConvexProfileAgentConfig<TPrompt>,
  ): CruxConvexAgent<TPrompt>
  /** Register the HTTP devtools bridge using this profile's store path. */
  bridge(
    http: CruxConvexBridgeHttpRouter,
    crux: Crux,
    options?: Omit<CruxConvexBridgeSetupOptions, 'component' | 'store'>,
  ): void
}

/** Options for `createCruxConvex()`. */
export interface CreateCruxConvexOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /**
   * The two Convex components the Crux profile needs.
   *
   * Keeping both under one `components` object avoids ambiguous lower-level
   * option names in public APIs.
   */
  readonly components: CruxConvexComponents
  /**
   * Default namespace for memory and skill persistence.
   *
   * If omitted, the runtime falls back to `thread:${threadId}`,
   * `user:${userId}`, then `default`.
   */
  readonly namespace?: ConvexCruxRuntime<TCtx>['namespace']
  /**
   * Store options for the profile's request-scoped default store.
   *
   * This is the preferred home for vector index/cache options and the custom
   * store factory override.
   */
  readonly store?: CruxConvexProfileStoreOptions<TCtx>
  /**
   * @deprecated Use `store.vectorIndexName`.
   */
  readonly vectorIndexName?: string
  /**
   * @deprecated Use `store.semanticCache`.
   */
  readonly semanticCache?: ConvexMemoryStoreConfig<TCtx>['semanticCache']
}

/**
 * Create a Convex runtime profile for Crux.
 *
 * The profile is the owning boundary for request-scoped runtime state:
 * component refs, ctx, target, store, namespace, agent defaults, and bridge
 * store reads.
 *
 * @param options - Components and optional namespace/store defaults.
 * @returns A reusable Convex Crux profile.
 *
 * @example
 * ```ts
 * export const crux = createCruxConvex({
 *   components: { crux: components.crux, agent: components.agent },
 * })
 *
 * await crux.run(ctx, { threadId }, async ({ store }) => {
 *   await store.set(`blackboard:${threadId}`, { status: 'ready' })
 * })
 * ```
 */
export function createCruxConvex<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  options: CreateCruxConvexOptions<TCtx>,
): CruxConvexProfile<TCtx> {
  const storeForCtx = createCruxConvexStoreResolver<TCtx>({
    component: options.components.crux,
    vectorIndexName: options.store?.vectorIndexName ?? options.vectorIndexName,
    semanticCache: options.store?.semanticCache ?? options.semanticCache,
    create: options.store?.create,
  })

  function runtimeFor<TTarget extends ConvexRuntimeTarget>(
    ctx: TCtx,
    target: TTarget | undefined,
    store: CruxStore,
  ): ConvexCruxRuntime<TCtx, TTarget> {
    return {
      ctx,
      component: options.components.crux,
      store,
      target,
      namespace: options.namespace,
    }
  }

  function runWithStore<R, TTarget extends ConvexRuntimeTarget>(
    ctx: TCtx,
    target: TTarget | undefined,
    store: CruxStore,
    fn: (runtime: ConvexCruxRuntime<TCtx, TTarget>) => R,
  ): R {
    const runtime = runtimeFor(ctx, target, store)
    return runWithConvexCruxRuntime(runtime, () => fn(runtime))
  }

  const profile: CruxConvexProfile<TCtx> = {
    components: options.components,
    store(ctx: TCtx): CruxStore | Promise<CruxStore> {
      return storeForCtx(ctx)
    },
    async run<TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget, TResult = unknown>(
      ctx: TCtx,
      target: TTarget | undefined,
      fn: (scope: CruxConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
    ): Promise<Awaited<TResult>> {
      const store = await storeForCtx(ctx)
      return await runWithStore(ctx, target, store, (runtime) =>
        fn({
          ctx,
          target,
          store,
          runtime,
        }),
      )
    },
    withRuntime<R, TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget>(
      ctx: TCtx,
      target: TTarget | undefined,
      fn: () => R,
    ): R | Promise<Awaited<R>> {
      const storeOrPromise = storeForCtx(ctx)
      if (isPromiseLike(storeOrPromise)) {
        return storeOrPromise.then((store) => Promise.resolve(runWithStore(ctx, target, store, () => fn()))) as Promise<
          Awaited<R>
        >
      }
      return runWithStore(ctx, target, storeOrPromise, () => fn())
    },
    convexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>>(
      config: CruxConvexProfileAgentConfig<TPrompt>,
    ): CruxConvexAgent<TPrompt> {
      return createConvexAgent({
        ...config,
        components: options.components,
        namespace: config.namespace ?? options.namespace,
        store: (ctx) => {
          assertConvexCtxPort(ctx)
          return storeForCtx(ctx as TCtx)
        },
      })
    },
    bridge(
      http: CruxConvexBridgeHttpRouter,
      crux: Crux,
      bridgeOptions?: Omit<CruxConvexBridgeSetupOptions, 'component' | 'store'>,
    ): void {
      setupBridge(http, crux, {
        ...bridgeOptions,
        store: (ctx) => {
          assertConvexCtxPort(ctx)
          return storeForCtx(ctx as TCtx)
        },
      })
    },
  }

  return Object.freeze(profile)
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return !!value && typeof value === 'object' && 'then' in value
}
