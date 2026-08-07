/**
 * Focused PostgreSQL transport statistics concurrency and prune semantics.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptTransportEnvelope,
  transportStatistics,
  type RuntimeAcceptedTransportEnvelope,
} from '@use-crux/core/runtime'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

function inlinePayload(text: string) {
  const bytes = new TextEncoder().encode(text)
  return {
    kind: 'inline-base64url' as const,
    value: Buffer.from(bytes).toString('base64url'),
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function sampleEnvelope(eventId: string): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: 'RuntimeAcceptedTransportEnvelope',
    schemaVersion: 1,
    bindingId: 'binding.orders',
    adapterId: 'adapter.orders',
    provider: 'orders',
    accountId: 'acct_1',
    eventId,
    receivedAt: '2026-08-04T12:00:00.000Z',
    authenticatedRouting: { source: 'webhook' },
    payload: inlinePayload(JSON.stringify({ orderId: 'ord_1' })),
    configRef: { id: 'cfg.orders', revision: '1' },
    target: { kind: 'signal', signalId: 'order.submitted' },
  }
}

describe('PostgreSQL transport statistics and prune', () => {
  let database: PostgresTestDatabase
  let schemaSerial = 0

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })

  async function withStore<T>(
    run: (store: PostgresRuntimeStore) => Promise<T>,
  ): Promise<T> {
    const schema = `crux_transport_stats_${schemaSerial++}_${Math.random()
      .toString(36)
      .slice(2, 8)}`
    const pool = createPostgresTestPool(database.url)
    const store = postgres({ pool, schema })
    try {
      const setup = await store.setup.apply()
      if (!setup.ok) {
        throw new Error(
          setup.findings.map((finding) => finding.message).join('; '),
        )
      }
      return await run(store)
    } finally {
      await store.close()
      await pool.end()
    }
  }

  it(
    'preserves concurrent accept statistics under READ COMMITTED',
    async () => {
      await withStore(async (store) => {
        const namespace = 'stats-race'
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            acceptTransportEnvelope({
              store,
              namespace,
              envelope: sampleEnvelope(`evt_race_${index}`),
              now: new Date(`2026-08-04T18:00:0${index}.000Z`),
            }),
          ),
        )

        expect(results.every((result) => result.kind === 'accepted')).toBe(true)

        const stats = await transportStatistics({ store, namespace })
        expect(stats.total.accepted).toBe(8)
        expect(stats.total.deduplicated).toBe(0)
      })
    },
    60_000,
  )

  it(
    'reports prune truncated only when eligible rows remain after the limit',
    async () => {
      await withStore(async (store) => {
        const namespace = 'prune-ns'
        const before = new Date('2026-08-05T00:00:00.000Z')

        for (let index = 0; index < 3; index += 1) {
          await store.transact(async (tx) => {
            if (!tx.transports) {
              throw new Error('missing transports')
            }
            const accept = await tx.transports.accept({
              namespace,
              envelope: sampleEnvelope(`evt_prune_${index}`),
              envelopeDigest: `digest-${index}`,
              maxAttempts: 3,
              now: new Date(`2026-08-04T10:00:0${index}.000Z`),
            })
            if (accept.kind !== 'accepted') {
              throw new Error(`expected accepted, got ${accept.kind}`)
            }
            const claimed = await tx.transports.claim({
              namespace,
              now: new Date(`2026-08-04T10:01:0${index}.000Z`),
              limit: 1,
              leaseMs: 30_000,
              leaseToken: `lease-${index}`,
            })
            const record = claimed[0]
            if (!record?.leaseToken) {
              throw new Error('missing claimed record')
            }
            await tx.transports.completeNormalization({
              identity: {
                namespace,
                provider: record.provider,
                accountId: record.accountId,
                eventId: record.eventId,
              },
              leaseToken: record.leaseToken,
              now: new Date(`2026-08-04T10:02:0${index}.000Z`),
              lineage: [],
            })
          })
        }

        const exactLimit = await store.transact(async (tx) => {
          if (!tx.transports) {
            throw new Error('missing transports')
          }
          return tx.transports.prune({
            namespace,
            before,
            limit: 3,
          })
        })
        expect(exactLimit).toEqual({ removed: 3, truncated: false })

        for (let index = 0; index < 2; index += 1) {
          await store.transact(async (tx) => {
            if (!tx.transports) {
              throw new Error('missing transports')
            }
            const accept = await tx.transports.accept({
              namespace,
              envelope: sampleEnvelope(`evt_prune_more_${index}`),
              envelopeDigest: `digest-more-${index}`,
              maxAttempts: 3,
              now: new Date(`2026-08-04T11:00:0${index}.000Z`),
            })
            if (accept.kind !== 'accepted') {
              throw new Error(`expected accepted, got ${accept.kind}`)
            }
            const claimed = await tx.transports.claim({
              namespace,
              now: new Date(`2026-08-04T11:01:0${index}.000Z`),
              limit: 1,
              leaseMs: 30_000,
              leaseToken: `lease-more-${index}`,
            })
            const record = claimed[0]
            if (!record?.leaseToken) {
              throw new Error('missing claimed record')
            }
            await tx.transports.completeNormalization({
              identity: {
                namespace,
                provider: record.provider,
                accountId: record.accountId,
                eventId: record.eventId,
              },
              leaseToken: record.leaseToken,
              now: new Date(`2026-08-04T11:02:0${index}.000Z`),
              lineage: [],
            })
          })
        }

        const limited = await store.transact(async (tx) => {
          if (!tx.transports) {
            throw new Error('missing transports')
          }
          return tx.transports.prune({
            namespace,
            before,
            limit: 1,
          })
        })
        expect(limited).toEqual({ removed: 1, truncated: true })

        const remainder = await store.transact(async (tx) => {
          if (!tx.transports) {
            throw new Error('missing transports')
          }
          return tx.transports.prune({
            namespace,
            before,
            limit: 10,
          })
        })
        expect(remainder).toEqual({ removed: 1, truncated: false })
      })
    },
    60_000,
  )
})
