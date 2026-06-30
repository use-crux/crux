import { describeRecordStoreConformance } from '@use-crux/core/storage/testing/vitest'
import { describe, expect, it, vi } from 'vitest'
import { upstashRedisRecordStore, type RedisRecordClient, type RedisSubscriber } from '../redis-record-store'

describeRecordStoreConformance({
  name: 'upstashRedisRecordStore',
  prepare: () => upstashRedisRecordStore({ redis: createRedisRecordClient() }),
})

describe('upstashRedisRecordStore subscriptions', () => {
  it('unsubscribes from Redis when the last local watcher is removed', () => {
    const redis = createRedisRecordClient()
    const subscriber: RedisSubscriber = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    }
    const records = upstashRedisRecordStore({ redis, subscriber })

    const first = records.watch!('thread:', vi.fn())
    const second = records.watch!('thread:', vi.fn())
    first()
    expect(subscriber.unsubscribe).not.toHaveBeenCalled()
    second()

    expect(subscriber.subscribe).toHaveBeenCalledOnce()
    expect(subscriber.unsubscribe).toHaveBeenCalledWith('crux:events')
  })
})

function createRedisRecordClient(): RedisRecordClient & { readonly data: Map<string, StoredRedisValue> } {
  const data = new Map<string, StoredRedisValue>()
  return {
    data,
    async get<T = string>(key: string): Promise<T | null> {
      const entry = data.get(key)
      if (!entry || isExpired(entry)) {
        data.delete(key)
        return null
      }
      return entry.value as T
    },
    async set(key: string, value: string, opts?: { px?: number; nx?: true }): Promise<'OK' | null> {
      const existing = data.get(key)
      if (opts?.nx && existing && !isExpired(existing)) return null
      data.set(key, {
        value,
        expiresAt: opts?.px === undefined ? undefined : Date.now() + opts.px,
      })
      return 'OK'
    },
    async del(...keys: string[]): Promise<number> {
      let deleted = 0
      for (const key of keys) {
        if (data.delete(key)) deleted += 1
      }
      return deleted
    },
    async scan(cursor: string, options?: { match?: string; count?: number }): Promise<[string, string[]]> {
      const keys = [...data.keys()]
        .filter((key) => {
          const entry = data.get(key)
          if (!entry || isExpired(entry)) {
            data.delete(key)
            return false
          }
          return options?.match ? key.startsWith(options.match.replace(/\*$/, '')) : true
        })
        .sort()
      const start = Number(cursor)
      const count = options?.count ?? keys.length
      const page = keys.slice(start, start + count)
      const next = start + count < keys.length ? String(start + count) : '0'
      return [next, page]
    },
    async publish() {
      return 0
    },
  }
}

interface StoredRedisValue {
  readonly value: string
  readonly expiresAt?: number
}

function isExpired(entry: StoredRedisValue): boolean {
  return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt
}
