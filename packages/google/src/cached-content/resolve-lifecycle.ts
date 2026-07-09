/**
 * Adapt a `createGoogle()` cache option into a CachedContent lifecycle.
 *
 * `createGoogle()` accepts four forms, all normalized here into one
 * {@link GoogleCachedContentLifecycle}:
 *
 * - `false` — a no-op lifecycle that always sends an inline `systemInstruction`.
 * - `GoogleCacheConfig` (or omitted) — the built-in lifecycle, backed by the
 *   SDK cache port (or a custom `config.port`).
 * - {@link GoogleCachedContentLifecycle} — an advanced user-supplied lifecycle,
 *   returned verbatim.
 *
 * @module
 */

import type { GoogleGenAI } from '@google/genai'
import type { GoogleCacheConfig } from './config'
import { resolveCacheConfig } from './config'
import { createBuiltInCachedContentLifecycle } from './built-in-lifecycle'
import { googleSdkCachePort } from './sdk-cache-port'
import type {
  GoogleCachedContentLifecycle,
  GoogleCachedContentPlan,
  GoogleCachedContentPrepareArgs,
} from './types'

/**
 * The cache option accepted by `createGoogle()`.
 *
 * - `false` disables caching.
 * - `GoogleCacheConfig` tunes the built-in lifecycle.
 * - {@link GoogleCachedContentLifecycle} fully replaces the built-in behavior.
 */
export type GoogleCachedContentOption = false | GoogleCacheConfig | GoogleCachedContentLifecycle

/** Normalize a `createGoogle()` cache option into a lifecycle bound to `client`. */
export function resolveCachedContentLifecycle(
  client: GoogleGenAI,
  option: GoogleCachedContentOption | undefined,
): GoogleCachedContentLifecycle {
  if (option === false) return disabledCachedContentLifecycle()
  if (isLifecycle(option)) return option

  return createBuiltInCachedContentLifecycle({
    port: option?.port ?? googleSdkCachePort(client),
    config: resolveCacheConfig(option),
  })
}

/** A lifecycle that always falls back to a plain inline `systemInstruction`. */
export function disabledCachedContentLifecycle(): GoogleCachedContentLifecycle {
  return {
    async prepare(args: GoogleCachedContentPrepareArgs): Promise<GoogleCachedContentPlan> {
      return {
        mode: 'inline',
        reason: 'disabled',
        config: args.system ? { systemInstruction: args.system } : {},
      }
    },
  }
}

/** Distinguish a full lifecycle from a plain config by its `prepare` method. */
function isLifecycle(
  option: GoogleCacheConfig | GoogleCachedContentLifecycle | undefined,
): option is GoogleCachedContentLifecycle {
  return typeof (option as GoogleCachedContentLifecycle | undefined)?.prepare === 'function'
}
