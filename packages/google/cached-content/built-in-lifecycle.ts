/**
 * Built-in Google CachedContent lifecycle.
 *
 * Composes the pure {@link planSystemBlocks} planner, the {@link
 * GoogleCachedContentStore}, a {@link GoogleCachedContentCachePort}, and the
 * configured fallback policy into the single {@link GoogleCachedContentLifecycle}
 * boundary that `googleRequest()` consumes. This is the only module that decides
 * how cache misses and cache errors degrade to an inline `systemInstruction`.
 *
 * @module
 */

import type { ResolvedCacheConfig } from './config'
import { GoogleCachedContentStore } from './cache-store'
import { planSystemBlocks } from './planner'
import type {
  GoogleCachedContentCachePort,
  GoogleCachedContentCallOptions,
  GoogleCachedContentInlinePlan,
  GoogleCachedContentInlineReason,
  GoogleCachedContentLifecycle,
  GoogleCachedContentPlan,
  GoogleCachedContentPrepareArgs,
} from './types'

/** Dependencies for the built-in lifecycle. */
export interface BuiltInCachedContentLifecycleDeps {
  /** External cache operations boundary (SDK-backed or custom). */
  readonly port: GoogleCachedContentCachePort
  /** Fully-resolved value config. */
  readonly config: ResolvedCacheConfig
}

/**
 * Create the built-in {@link GoogleCachedContentLifecycle}.
 *
 * Caching is treated as an optimization: when it is disabled, skipped,
 * inapplicable, or fails under `onError: 'fallback'`, the request degrades to a
 * plain `systemInstruction` and generation continues. Under `onError: 'throw'`,
 * cache operation failures surface to the caller instead.
 */
export function createBuiltInCachedContentLifecycle(
  deps: BuiltInCachedContentLifecycleDeps,
): GoogleCachedContentLifecycle {
  const store = new GoogleCachedContentStore(deps.port, {
    defaultTtlSeconds: deps.config.defaultTtlSeconds,
    maxEntries: deps.config.maxEntries,
  })

  async function prepare(args: GoogleCachedContentPrepareArgs): Promise<GoogleCachedContentPlan> {
    if (!deps.config.enabled) return inline('disabled', args.system)
    if (args.call?.skip) return inline('skipped', args.system)

    const { cacheablePrefix, uncachedInstruction } = planSystemBlocks(args)
    if (cacheablePrefix.length === 0) return inline('no-cacheable-prefix', args.system)

    const ttlSeconds = resolveCallTtlSeconds(args.call, deps.config.defaultTtlSeconds)

    let resolution
    try {
      resolution = await store.resolve({
        model: args.model,
        texts: cacheablePrefix.map((block) => block.text),
        ttlSeconds,
      })
    } catch (error) {
      if (deps.config.onError === 'throw') throw error
      console.warn('[crux-google] CachedContent operation failed, falling back to uncached.')
      return inline('fallback', args.system)
    }

    if (!resolution) return inline('miss', args.system)

    return {
      mode: 'cached',
      config: {
        cachedContent: resolution.name,
        ...(uncachedInstruction ? { systemInstruction: uncachedInstruction } : {}),
      },
      meta: { ttlSeconds, key: resolution.key, reused: resolution.reused },
    }
  }

  return {
    prepare,
    dispose: () => store.dispose(),
  }
}

/**
 * Resolve the TTL for a request.
 *
 * A per-call override is honored only when it is a finite, positive number;
 * anything else (0, negative, `NaN`, `Infinity`) falls back to the adapter
 * default rather than poisoning the cache key, local expiry, or the SDK
 * `ttl: "<n>s"` payload.
 */
function resolveCallTtlSeconds(call: GoogleCachedContentCallOptions | undefined, fallback: number): number {
  const override = call?.ttlSeconds
  return typeof override === 'number' && Number.isFinite(override) && override > 0 ? override : fallback
}

/** Build an inline (uncached) plan, omitting `systemInstruction` when absent. */
function inline(reason: GoogleCachedContentInlineReason, system: string | undefined): GoogleCachedContentInlinePlan {
  return {
    mode: 'inline',
    reason,
    config: system ? { systemInstruction: system } : {},
  }
}
