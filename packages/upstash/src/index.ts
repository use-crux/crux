/**
 * `@use-crux/upstash` - Upstash Storage Beta adapters for Crux.
 *
 * Exposes Redis {@link RecordStore} and Upstash Vector-backed {@link SearchStore}
 * adapters as explicit Storage Beta capabilities.
 *
 * @module
 */

export { upstashRedisRecordStore } from './redis-record-store'
export type { RedisRecordClient, RedisSubscriber, UpstashRedisRecordStoreConfig } from './redis-record-store'
export { upstashFilter, upstashSearchStore } from './search-store'
export type { UpstashIndex, UpstashNamespace, UpstashSearchStoreConfig } from './search-store'
