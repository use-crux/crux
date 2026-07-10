import { decodeWakeEnvelope, type WakeEnvelope, type WorkId } from '@use-crux/core/runtime'

/** Create Convex-local Runtime Engine work ids for waiter, timer, and retry fan-out. */
export function createConvexWorkIdGenerator(): () => WorkId {
  let counter = 0
  return () => `work_convex_${Date.now().toString(36)}_${++counter}_${randomWorkIdSuffix()}` as WorkId
}

/** Decode a Convex-transported wake envelope from object or string payloads. */
export function decodeConvexWakeEnvelope(envelope: unknown): WakeEnvelope {
  return decodeWakeEnvelope(typeof envelope === 'string' ? envelope : JSON.stringify(envelope))
}

function randomWorkIdSuffix(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  return Math.random().toString(36).slice(2, 12)
}
