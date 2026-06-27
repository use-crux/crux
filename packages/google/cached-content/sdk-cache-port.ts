/**
 * Google SDK adapter for the CachedContent cache port.
 *
 * Bridges the narrow {@link GoogleCachedContentCachePort} (create/delete) onto a
 * concrete `GoogleGenAI` client's `caches` API. This is the one place that
 * knows the SDK's payload shape (`config.ttl` as a `"<n>s"` string), keeping
 * the store and lifecycle free of `@google/genai` wire details.
 *
 * @module
 */

import type { GoogleGenAI } from '@google/genai'
import type { GoogleCacheName, GoogleCachedContentCachePort } from './types'

/** Adapt a `GoogleGenAI` client into a {@link GoogleCachedContentCachePort}. */
export function googleSdkCachePort(client: GoogleGenAI): GoogleCachedContentCachePort {
  return {
    async create({ model, systemInstruction, ttlSeconds }) {
      const cached = await client.caches.create({
        model,
        config: { systemInstruction, ttl: `${ttlSeconds}s` },
      })
      return cached.name ? (cached.name as GoogleCacheName) : undefined
    },

    async delete({ name }) {
      await client.caches.delete({ name })
    },
  }
}
