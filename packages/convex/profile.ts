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
import type { z } from 'zod'
import type { CruxConvexBridgeHttpRouter } from './bridge'
import { convexAgent as createConvexAgent } from './agent'
import type { ConvexAgentBaseConfig, ConvexAgentComponent, ConvexAgentModelConfig, CruxConvexAgent } from './agent'
import { assertConvexCtxPort, type CruxConvexProfileStoreOptions } from './profile-store'
import { createConvexRuntimeBridge } from './runtime-bridge'
import type { ConvexRunScope, ConvexRuntimeBridge, ConvexRuntimeBridgeSetupOptions } from './runtime-bridge'
import type { ConvexMemoryNamespace, ConvexRuntimeTarget } from './runtime'
import type { ComponentApi } from './src/component/_generated/component'
import type { ConvexCtxPort } from './store'

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
> = Omit<ConvexAgentBaseConfig<TPrompt>, 'components' | 'store'> & ConvexAgentModelConfig

/** Scope passed to `CruxConvexProfile.run()`. */
export type CruxConvexRunScope<TCtx extends ConvexCtxPort, TTarget extends ConvexRuntimeTarget> = ConvexRunScope<
  TCtx,
  TTarget
>

/** Reusable Convex runtime profile created by `createCruxConvex()`. */
export interface CruxConvexProfile<TCtx extends ConvexCtxPort = ConvexCtxPort> extends ConvexRuntimeBridge<TCtx> {
  /** Component refs captured by the profile. */
  readonly components: CruxConvexComponents
  /** Create a Convex Agent wrapper using this profile's components and store. */
  convexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>>(
    config: CruxConvexProfileAgentConfig<TPrompt>,
  ): CruxConvexAgent<TPrompt>
  /** Register the HTTP devtools bridge using this profile's store path. */
  bridge(http: CruxConvexBridgeHttpRouter, crux: Crux, options?: ConvexRuntimeBridgeSetupOptions): void
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
  readonly namespace?: ConvexMemoryNamespace
  /**
   * Store options for the profile's request-scoped default store.
   *
   * This is the preferred home for vector index/cache options and the custom
   * store factory override.
   */
  readonly store?: CruxConvexProfileStoreOptions<TCtx>
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
  const runtime = createConvexRuntimeBridge<TCtx>({
    component: options.components.crux,
    namespace: options.namespace,
    store: options.store,
  })

  const profile: CruxConvexProfile<TCtx> = {
    ...runtime,
    components: options.components,
    convexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>>(
      config: CruxConvexProfileAgentConfig<TPrompt>,
    ): CruxConvexAgent<TPrompt> {
      return createConvexAgent({
        ...config,
        components: options.components,
        namespace: config.namespace ?? options.namespace,
        store: (ctx) => {
          assertConvexCtxPort(ctx)
          return runtime.store(ctx as TCtx)
        },
      })
    },
  }

  return Object.freeze(profile)
}
