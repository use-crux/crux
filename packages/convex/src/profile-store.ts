/**
 * Shared storage construction for the Convex runtime profile.
 *
 * `createCruxConvex()`, standalone `convexAgent()`, and the HTTP bridge all
 * normalize through this module so component-backed defaults and custom storage
 * overrides cannot drift.
 *
 * @module
 */

import type { RecordStore, Storage } from '@use-crux/core/storage'
import type { ComponentApi } from './component/_generated/component'
import { convexStorage } from './storage'
import type { ConvexCtxPort } from './store'

/** Defaults provided to a custom profile storage factory. */
export interface CruxConvexProfileStorageDefaults {
  /** Crux persistence component ref from `components.crux`. */
  readonly component: ComponentApi
  /**
   * Build the standard component-backed storage bundle for a ctx.
   *
   * Custom factories can call this to wrap, decorate, or selectively delegate
   * to the default storage without duplicating component wiring.
   */
  createComponentStorage(ctx: ConvexCtxPort): Storage
}

export type ConvexProfileStorageResult = Storage | RecordStore

/** Optional advanced storage override accepted by `createCruxConvex()`. */
export interface CruxConvexProfileStorageOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /**
   * Replace or wrap the default component-backed storage for this request.
   *
   * This is the single profile-level escape hatch for tests, migrations, and
   * alternate storage. Most apps should omit it and use the component-backed
   * default.
   */
  readonly create?: (
    ctx: TCtx,
    defaults: CruxConvexProfileStorageDefaults,
  ) => ConvexProfileStorageResult | Promise<ConvexProfileStorageResult>
}

interface CreateProfileStorageResolverOptions<TCtx extends ConvexCtxPort>
  extends CruxConvexProfileStorageOptions<TCtx> {
  readonly component: ComponentApi
}

/** Build the standard component-backed storage bundle from shared profile defaults. */
export function createDefaultConvexStorage<TCtx extends ConvexCtxPort>(
  ctx: TCtx,
  options: {
    readonly component: ComponentApi
  },
): Storage {
  return convexStorage({
    component: options.component,
    ctx,
  })
}

/** Assert an unknown value can be used as the minimal Convex ctx port. */
export function assertConvexCtxPort(ctx: unknown): asserts ctx is ConvexCtxPort {
  if (!isRecord(ctx) || typeof ctx.runQuery !== 'function' || typeof ctx.runMutation !== 'function') {
    throw new Error('A Convex ctx with runQuery() and runMutation() is required to create Convex-backed Crux storage.')
  }
}

/**
 * Create a request-scoped storage resolver for a profile.
 *
 * The returned function may be synchronous or asynchronous depending on the
 * custom `storage.create` override. Callers that need to support both should
 * `await` the result.
 */
export function createCruxConvexStorageResolver<TCtx extends ConvexCtxPort>(
  options: CreateProfileStorageResolverOptions<TCtx>,
): (ctx: TCtx) => Storage | Promise<Storage> {
  const defaults: CruxConvexProfileStorageDefaults = Object.freeze({
    component: options.component,
    createComponentStorage(ctx: ConvexCtxPort) {
      assertConvexCtxPort(ctx)
      return createDefaultConvexStorage(ctx, {
        component: options.component,
      })
    },
  })

  return async (ctx) => {
    if (options.create) return normalizeStorage(await options.create(ctx, defaults))
    return defaults.createComponentStorage(ctx)
  }
}

function normalizeStorage(value: ConvexProfileStorageResult): Storage {
  return 'records' in value ? value : { records: value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
