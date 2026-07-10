/**
 * Convex transport for `@use-crux/react` hooks.
 *
 * Uses Convex's native `useQuery()` for automatic WebSocket-based reactivity.
 * App code should pass the Crux component API used by `convexStorage()` so
 * server records and React reads share one document contract.
 *
 * @example
 * ```tsx
 * import { CruxProvider } from '@use-crux/react'
 * import { useQuery } from 'convex/react'
 * import { api } from '../convex/_generated/api'
 *
 * const transport = createConvexTransport({ api: api.crux, useQuery })
 *
 * <ConvexProvider client={convex}>
 *   <CruxProvider transport={transport}>
 *     <App />
 *   </CruxProvider>
 * </ConvexProvider>
 * ```
 *
 * @module
 */

/**
 * The Convex `useQuery` hook shape — taken without a typed
 * `FunctionReference<...>` because importing Convex's strongly-typed reference
 * here triggers `TS2589: type instantiation excessively deep`. Adapter bridge.
 */
type UseQueryArgs = Record<string, unknown> | 'skip'

export type UseQueryFn = (query: unknown, args: UseQueryArgs) => unknown

/**
 * Configuration for the Convex transport.
 */
export interface ConvexTransportConfig {
  /** The Convex component API (e.g., `api.crux` or `components.crux`). */
  api: ConvexCruxStorageTransportComponent
  /**
   * The Convex `useQuery` hook. Pass this to avoid requiring `convex/react`
   * as a direct dependency of `@use-crux/convex`.
   *
   * @example
   * ```ts
   * import { useQuery } from 'convex/react'
   * cruxDocuments.transport({ useQuery })
   * ```
   */
  useQuery: UseQueryFn
  /** Clock used for TTL checks. Defaults to `Date.now`. */
  now?: StoreDocCodecOptions['now']
}

// Re-export the transport type for convenience
export type { CruxTransport } from '@use-crux/react'
import type { CruxTransport } from '@use-crux/react'
import type { JsonObject, RecordEntry, RecordListOptions } from '@use-crux/core/storage'
import type { ConvexCruxStorageTransportComponent } from './store-component'
import {
  createStoreDocCodec,
  type StoreDocCodecOptions,
  type StoreDocPage,
  type StoreDocPageQuery,
  type StoreDocRecord,
} from './store-doc'

/**
 * Create a `CruxTransport` backed by Convex's reactive queries.
 *
 * Uses the crux Convex component's `memory.get` and `memory.list` queries,
 * which are automatically reactive via Convex's WebSocket protocol.
 *
 * Crux records are serialized as JSON in the `content` field with
 * a `{ _cruxDoc: true }` metadata marker. The transport deserializes them
 * back to `JsonObject` on read.
 *
 * @param config - Component API reference and useQuery hook.
 * @returns A `CruxTransport` for use with `<CruxProvider>`.
 *
 * @example
 * ```tsx
 * import { useQuery } from 'convex/react'
 * const transport = createConvexTransport({ api: api.crux, useQuery })
 *
 * <CruxProvider transport={transport}>
 *   <App />
 * </CruxProvider>
 * ```
 */
export function createConvexTransport(config: ConvexTransportConfig): CruxTransport {
  const { api, now, useQuery } = config
  const docs = createStoreDocCodec({ now })

  return {
    useDocument(key: string | undefined): JsonObject | null | undefined {
      const result = useQuery(api.memory.get, key !== undefined ? { key } : 'skip')
      return docs.value(result as StoreDocRecord | null | undefined)
    },

    useDocumentList(prefix: string | undefined, options?: RecordListOptions): RecordEntry[] | undefined {
      const result = useQuery(
        api.memory.list,
        prefix !== undefined
          ? storeDocPageArgs({
              prefix,
              limit: options?.limit,
              cursor: options?.cursor,
            })
          : 'skip',
      )
      if (result === undefined) return undefined // loading
      return docs.entries((result as StoreDocPage<StoreDocRecord>).docs, { filter: options?.filter })
    },
  }
}

function storeDocPageArgs(query: StoreDocPageQuery): Record<string, unknown> {
  return {
    prefix: query.prefix,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  }
}
