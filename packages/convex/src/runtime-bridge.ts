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
import { withNamedOnlyDefer } from '@use-crux/core/defer/serverless'
import { runScope } from '@use-crux/core/internal/scope'
import {
  bindHostRuntime,
  runWithRuntimeHost,
  type RuntimeHostBinder,
} from '@use-crux/core/runtime'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import { makeFunctionReference, type PublicHttpAction } from 'convex/server'
import { setup as setupBridge } from './bridge'
import type {
  CruxConvexBridgeHttpRouter,
  CruxConvexBridgeSetupOptions,
} from './bridge'
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
import {
  convex,
  type ConvexRuntimeEngineDefinition,
} from './runtime-engine/definition'
import { createConvexWorkIdGenerator } from './runtime-engine/helpers'
import {
  convexRuntimeStore,
  type ConvexRuntimeComponent,
} from './runtime-engine/store'
import type { ComponentApi } from './component/_generated/component'
import type { ConvexCtxPort } from './store'
import { flushObservability } from './observability'

const DEFAULT_TARGET_EXECUTOR = '_crux/targets:executeTarget'
const DEFAULT_EVAL_HTTP_HANDLER = '_crux/targets:handleEvalRequest'

/** HTTP bridge options accepted by `ConvexRuntimeBridge.bridge()`. */
export type ConvexRuntimeBridgeSetupOptions = Omit<
  CruxConvexBridgeSetupOptions,
  'component' | 'storage'
>

/** Scope passed to `ConvexRuntimeBridge.run()`. */
export interface ConvexRunScope<
  TCtx extends ConvexCtxPort,
  TTarget extends ConvexRuntimeTarget,
> {
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
export interface ConvexRuntimeBridge<
  TCtx extends ConvexCtxPort = ConvexCtxPort,
> {
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
   * active runtime while `fn` is executing. Before returning or rethrowing,
   * the boundary awaits Convex's fixed bounded terminal observability drain.
   */
  run<
    TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
    TResult = unknown,
  >(
    ctx: TCtx,
    target: TTarget | undefined,
    fn: (scope: ConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
  ): Promise<Awaited<TResult>>
  /** Register the HTTP devtools bridge using the same ctx-bound store path. */
  bridge(
    http: CruxConvexBridgeHttpRouter,
    crux: Crux,
    options?: ConvexRuntimeBridgeSetupOptions,
  ): void
}

/** Runtime Engine options for host-bound Convex execution. */
export interface ConvexRuntimeBridgeEngineOptions {
  /**
   * Host-bound runtime declaration.
   *
   * Most apps should configure `runtime: convex()` in `crux.config.ts` and omit
   * this option. It exists for tests and custom host declarations.
   */
  readonly declaration?: ConvexRuntimeEngineDefinition
  /**
   * Convex Node action reference used to execute generated runtime targets.
   *
   * Defaults to the `crux runtime generate` output path
   * `_crux/targets:executeTarget`.
   */
  readonly targetExecutor?: unknown
}

/** Internal options for `createConvexRuntimeBridge()`. */
export interface CreateConvexRuntimeBridgeOptions<
  TCtx extends ConvexCtxPort = ConvexCtxPort,
> {
  /** Crux persistence component installed from `@use-crux/convex/convex.config`. */
  readonly component: ComponentApi
  /**
   * Default namespace for memory and skill persistence.
   *
   * If omitted, the runtime falls back to `thread:${threadId}`,
   * `user:${userId}`, then `default`.
   */
  readonly namespace?: ConvexMemoryNamespace
  /** Runtime Engine host-binding options for direct flow starts and name-bound controls. */
  readonly runtime?: ConvexRuntimeBridgeEngineOptions
  /**
   * Storage options for the request-scoped default storage.
   *
   * This is the preferred home for custom store factory overrides.
   */
  readonly storage?: CruxConvexProfileStorageOptions<TCtx>
}

/**
 * Create the internal host/runtime bridge used by `createCruxConvex()`.
 *
 * This helper is intentionally not part of the public Convex package surface.
 * It centralizes request-scoped storage, runtime host binding, namespace
 * defaults, and the devtools HTTP bridge behind the profile entry point.
 *
 * @param options - Component ref plus optional namespace, runtime, and storage defaults.
 * @returns Internal bridge consumed by `createCruxConvex()`.
 */
export function createConvexRuntimeBridge<
  TCtx extends ConvexCtxPort = ConvexCtxPort,
>(options: CreateConvexRuntimeBridgeOptions<TCtx>): ConvexRuntimeBridge<TCtx> {
  const runtimeDeclaration = options.runtime?.declaration ?? convex()
  const targetExecutor =
    options.runtime?.targetExecutor ?? defaultTargetExecutor()
  const storageForCtx = createCruxConvexStorageResolver<TCtx>({
    component: options.component,
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
    async run<
      TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
      TResult = unknown,
    >(
      ctx: TCtx,
      target: TTarget | undefined,
      fn: (scope: ConvexRunScope<TCtx, TTarget>) => TResult | Promise<TResult>,
    ): Promise<Awaited<TResult>> {
      try {
        const storage = await storageForCtx(ctx)
        const runtime = runtimeFor(ctx, target, storage)
        return await runWithConvexCruxRuntime(runtime, () =>
          runWithRuntimeHost(
            {
              host: runtimeDeclaration.host,
              bind: createRuntimeHostBinder({
                ctx,
                component: options.component,
                targetExecutor,
              }),
            },
            () =>
              // Convex has no reliable post-return inline drain. Named Runtime
              // work remains available; inline defer(callback) throws.
              withNamedOnlyDefer(
                () =>
                  runScope({ kind: 'bridge-run' }, {}, () =>
                    fn({
                      ctx,
                      target,
                      storage,
                      records: storage.records,
                      runtime,
                    }),
                  ),
                { host: 'convex', durableFinalization: true },
              )(),
          ),
        )
      } finally {
        // Convex freezes an action after return, so this owning boundary must
        // await the fixed bounded terminal drain. The helper contains exporter
        // and reporter failures, preserving the application's exact outcome.
        await flushObservability()
      }
    },
    bridge(
      http: CruxConvexBridgeHttpRouter,
      crux: Crux,
      bridgeOptions?: ConvexRuntimeBridgeSetupOptions,
    ): void {
      setupBridge(http, crux, {
        ...bridgeOptions,
        storage: (ctx) => {
          assertConvexCtxPort(ctx)
          return storageForCtx(ctx as TCtx)
        },
      })
      registerEvalHttpRoutes(http)
    },
  })
}

function registerEvalHttpRoutes(http: CruxConvexBridgeHttpRouter): void {
  const handler = makeFunctionReference<'action'>(
    DEFAULT_EVAL_HTTP_HANDLER,
  ) as unknown as PublicHttpAction
  http.route({ path: '/manifest', method: 'GET', handler })
  http.route({ path: '/jobs', method: 'POST', handler })
  http.route({ pathPrefix: '/jobs/', method: 'GET', handler })
  http.route({ pathPrefix: '/jobs/', method: 'DELETE', handler })
}

function defaultTargetExecutor(): unknown {
  return makeFunctionReference<'action', { envelope: unknown }, unknown>(
    DEFAULT_TARGET_EXECUTOR,
  )
}

function createRuntimeHostBinder<TCtx extends ConvexCtxPort>(options: {
  readonly ctx: TCtx
  readonly component: ComponentApi
  readonly targetExecutor: unknown
}): RuntimeHostBinder {
  return (definition, runtimeOptions) => {
    return bindHostRuntime(definition, {
      ...runtimeOptions,
      store: convexRuntimeStore({
        ctx: options.ctx,
        component: runtimeComponent(options.component),
      }),
      createWake: () => wakeWithScheduler(options.ctx, options.targetExecutor),
      newWorkId: runtimeOptions.newWorkId ?? createConvexWorkIdGenerator(),
      leaseExtension: false,
      startMaintenance: runtimeOptions.startMaintenance ?? false,
    })
  }
}

function wakeWithScheduler<TCtx extends ConvexCtxPort>(
  ctx: TCtx,
  targetExecutor: unknown,
): (envelope: unknown) => Promise<void> {
  return async (envelope) => {
    await schedulerForCtx(ctx).runAfter(0, targetExecutor, { envelope })
  }
}

function schedulerForCtx(ctx: ConvexCtxPort): {
  runAfter(
    delayMs: number,
    ref: unknown,
    args: Record<string, unknown>,
  ): Promise<unknown>
} {
  const scheduler = (ctx as ConvexCtxPort & { scheduler?: unknown }).scheduler
  if (!scheduler || typeof scheduler !== 'object') {
    throw new Error(
      'Convex Runtime Engine wake delivery requires a Convex action context with ctx.scheduler.',
    )
  }
  const runAfter = (scheduler as { runAfter?: unknown }).runAfter
  if (typeof runAfter !== 'function') {
    throw new Error(
      'Convex Runtime Engine wake delivery requires ctx.scheduler.runAfter().',
    )
  }
  return {
    runAfter: runAfter as (
      delayMs: number,
      ref: unknown,
      args: Record<string, unknown>,
    ) => Promise<unknown>,
  }
}

function runtimeComponent(component: ComponentApi): ConvexRuntimeComponent {
  return component as unknown as ConvexRuntimeComponent
}
