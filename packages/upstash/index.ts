/**
 * `@use-crux/upstash` - Upstash Storage Beta adapters for Crux.
 *
 * Exposes a Redis {@link RecordStore} adapter and an Upstash Vector
 * {@link VectorStore} adapter without bundling them into one legacy store
 * shape.
 *
 * @module
 */

export { upstashRedisRecordStore } from './redis-record-store'
export type { RedisRecordClient, RedisSubscriber, UpstashRedisRecordStoreConfig } from './redis-record-store'
export { upstashFilter, upstashVectorStore } from './vector-store'
export type { UpstashIndex, UpstashNamespace, UpstashVectorStoreConfig } from './vector-store'
