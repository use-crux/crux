/**
 * Convex transport for `@crux/react` hooks.
 *
 * Uses Convex's native `useQuery()` for automatic WebSocket-based reactivity.
 * Plans, task lists, and tasks stored via `cruxConvexStore()` are automatically
 * reactive — no polling or SSE needed.
 *
 * @example
 * ```tsx
 * import { CruxProvider } from '@crux/react'
 * import { createConvexTransport } from '@crux/convex/react'
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex FunctionReference bridge — see backend/CLAUDE.md
type UseQueryFn = (query: any, args: any) => any

/**
 * Minimal interface for the Convex component API.
 * Only requires the `memory` module with `get` and `list` query references.
 */
interface CruxComponentApi {
  memory: {
    get: unknown
    list: unknown
  }
}

/**
 * Configuration for the Convex transport.
 */
interface ConvexTransportConfig {
  /** The Convex component API (e.g., `api.crux` or `components.crux`). */
  api: CruxComponentApi
  /**
   * The Convex `useQuery` hook. Pass this to avoid requiring `convex/react`
   * as a direct dependency of `@crux/convex`.
   *
   * @example
   * ```ts
   * import { useQuery } from 'convex/react'
   * createConvexTransport({ api: api.crux, useQuery })
   * ```
   */
  useQuery: UseQueryFn
}

// Re-export the transport type for convenience
export type { CruxTransport } from '@crux/react'
import type { CruxTransport } from '@crux/react'
import type { JsonObject, StoreEntry, ListOptions } from '@crux/core/store'
import { createStoreDocCodec, type StoreDocRecord } from './store-doc'

/**
 * Create a `CruxTransport` backed by Convex's reactive queries.
 *
 * Uses the crux Convex component's `memory.get` and `memory.list` queries,
 * which are automatically reactive via Convex's WebSocket protocol.
 *
 * CruxStore documents are serialized as JSON in the `content` field with
 * a `{ _cruxDoc: true }` metadata marker. The transport deserializes them
 * back to `JsonObject` on read.
 *
 * @param config - Component API reference and useQuery hook.
 * @returns A `CruxTransport` for use with `<CruxProvider>`.
 *
 * @example
 * ```tsx
 * import { useQuery } from 'convex/react'
 * import { createConvexTransport } from '@crux/convex/react'
 *
 * const transport = createConvexTransport({
 *   api: api.crux,  // or components.crux
 *   useQuery,
 * })
 *
 * <CruxProvider transport={transport}>
 *   <App />
 * </CruxProvider>
 * ```
 */
export function createConvexTransport(config: ConvexTransportConfig): CruxTransport {
  const { api, useQuery } = config
  const docs = createStoreDocCodec()

  return {
    useDocument(key: string | undefined): JsonObject | null | undefined {
      const result = useQuery(api.memory.get, key !== undefined ? { key } : 'skip')
      return docs.value(result as StoreDocRecord | null | undefined)
    },

    useDocumentList(prefix: string | undefined, options?: ListOptions): StoreEntry[] | undefined {
      const result = useQuery(
        api.memory.list,
        prefix !== undefined ? { prefix, limit: options?.limit, filter: options?.filter } : 'skip',
      )
      if (result === undefined) return undefined // loading
      return docs.entries(result as StoreDocRecord[], { filter: options?.filter })
    },
  }
}
