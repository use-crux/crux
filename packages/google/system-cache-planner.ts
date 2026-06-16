/**
 * Google system prompt cache planner.
 *
 * This module owns the request-time decision for Google's CachedContent
 * integration. It deliberately returns only Google request config fields so
 * call and stream paths can share the same system prompt planning behavior.
 *
 * @module
 */

import type { SystemBlock } from '@crux/core'
import type { GoogleCacheName, GoogleCacheResolveOptions } from './cache-types'

/** Per-call cache controls accepted by the Google adapter. */
export interface GoogleSystemCacheCallOptions {
  /** Skip provider-level system prompt caching for this request. */
  readonly skip?: boolean
  /** TTL in seconds for a newly-created CachedContent object. */
  readonly ttlSeconds?: number
}

/** Minimal cache lifecycle boundary required by the planner. */
export interface GoogleSystemCacheResolver {
  /**
   * Resolve a server-side CachedContent resource for cacheable system blocks.
   *
   * Returning `undefined` means the request should fall back to a plain
   * `systemInstruction`.
   */
  resolve(
    model: string,
    blocks: readonly SystemBlock[],
    options?: GoogleCacheResolveOptions,
  ): Promise<GoogleCacheName | undefined>
}

/** Inputs needed to plan Google system prompt request config. */
export interface ResolveGoogleSystemConfigOptions {
  /** Cache lifecycle implementation. Omit to disable provider caching. */
  readonly cacheResolver?: GoogleSystemCacheResolver
  /** Provider model id used by CachedContent creation. */
  readonly model: string
  /** Flat fallback system instruction from the resolved prompt. */
  readonly system?: string
  /** Structured system blocks carrying provider-neutral cache hints. */
  readonly systemBlocks?: readonly SystemBlock[]
  /** Per-call provider cache controls. */
  readonly cache?: GoogleSystemCacheCallOptions
}

/** Google request system config emitted by the planner. */
export interface GoogleSystemConfig {
  /** Server-side CachedContent resource name for cacheable system prefix. */
  readonly cachedContent?: GoogleCacheName
  /** Uncached system instruction text to send inline with the request. */
  readonly systemInstruction?: string
}

/**
 * Resolve Google request config fields for system prompt caching.
 *
 * The planner treats CachedContent as an optimization boundary: if caching is
 * unavailable, skipped, uncacheable, or fails, the caller receives the plain
 * `systemInstruction` and generation can continue normally.
 */
export async function resolveGoogleSystemConfig(
  options: ResolveGoogleSystemConfigOptions,
): Promise<GoogleSystemConfig> {
  if (!options.cacheResolver || options.cache?.skip) {
    return { systemInstruction: options.system }
  }

  const cacheablePrefix = cacheableSystemPrefix(options.systemBlocks)
  if (cacheablePrefix.length === 0) {
    return { systemInstruction: options.system }
  }

  const cacheName = await options.cacheResolver.resolve(
    options.model,
    cacheablePrefix,
    options.cache?.ttlSeconds === undefined ? undefined : { ttlSeconds: options.cache.ttlSeconds },
  )
  if (!cacheName) {
    return { systemInstruction: options.system }
  }

  const uncachedBlocks = options.systemBlocks?.slice(cacheablePrefix.length) ?? []
  const systemInstruction = joinSystemBlocks(uncachedBlocks)

  return {
    cachedContent: cacheName,
    ...(systemInstruction ? { systemInstruction } : {}),
  }
}

function cacheableSystemPrefix(blocks: readonly SystemBlock[] | undefined): readonly SystemBlock[] {
  if (!blocks) return []

  const prefix: SystemBlock[] = []
  for (const block of blocks) {
    if (!block.providerCache) break
    prefix.push(block)
  }
  return prefix
}

function joinSystemBlocks(blocks: readonly SystemBlock[]): string | undefined {
  if (blocks.length === 0) return undefined

  const text = blocks.map((block) => block.text).join('\n\n')
  return text.length > 0 ? text : undefined
}
