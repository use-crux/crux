/**
 * `@use-crux/upstash` - Upstash Storage Beta adapters for Crux.
 *
 * Exposes Redis {@link RecordStore} and Upstash Vector {@link VectorStore}
 * adapters as explicit Storage Beta capabilities.
 *
 * @module
 */

export { upstashRedisRecordStore } from './redis-record-store'
export type { RedisRecordClient, RedisSubscriber, UpstashRedisRecordStoreConfig } from './redis-record-store'
export { upstashFilter, upstashVectorStore } from './vector-store'
export type { UpstashIndex, UpstashNamespace, UpstashVectorStoreConfig } from './vector-store'
