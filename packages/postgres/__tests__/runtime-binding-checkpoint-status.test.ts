/**
 * PostgreSQL binding checkpoint additive fields: configRef + status.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bindingLeaseResource,
  type Lease,
  type LeaseToken,
  type RuntimeTransportBindingCheckpoint,
} from '@use-crux/core/runtime'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

function sampleCheckpoint(options: {
  readonly namespace: string
  readonly bindingId: string
  readonly cursor: string | null
  readonly lastOwnerId?: string
  readonly configRef?: RuntimeTransportBindingCheckpoint['configRef']
  readonly status?: RuntimeTransportBindingCheckpoint['status']
  readonly lastErrorCode?: string
}): RuntimeTransportBindingCheckpoint {
  return Object.freeze({
    schemaVersion: 1 as const,
    namespace: options.namespace,
    bindingId: options.bindingId,
    cursor: options.cursor,
    updatedAt: '2026-08-07T12:00:00.000Z',
    lastPolledAt: '2026-08-07T12:00:00.000Z',
    ...(options.lastOwnerId !== undefined
      ? { lastOwnerId: options.lastOwnerId }
      : {}),
    ...(options.lastErrorCode !== undefined
      ? { lastErrorCode: options.lastErrorCode }
      : {}),
    ...(options.configRef !== undefined
      ? { configRef: options.configRef }
      : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  })
}

describe('PostgreSQL binding checkpoint configRef and status', () => {
  let database: PostgresTestDatabase
  let nextSchema = 0

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })

  it('encodes and decodes configRef with active status (DDL columns present)', async () => {
    await withStore(async (store) => {
      const namespace = 'checkpoint-status-roundtrip'
      const bindingId = 'binding.orders.stream'
      const resource = bindingLeaseResource(namespace, bindingId)
      const lease = await store.leases.claim(resource, {
        ttlMs: 30_000,
        ownerId: 'worker-a',
      })
      expect(lease).not.toBeNull()

      for (const status of ['active', 'faulted', 'disabled'] as const) {
        const written = sampleCheckpoint({
          namespace,
          bindingId,
          cursor: 'cursor:held',
          lastOwnerId: 'worker-a',
          lastErrorCode:
            status === 'faulted' ? 'TRANSPORT_STREAM_TERMINAL' : undefined,
          configRef: { id: 'config.orders', revision: 'rev.3' },
          status,
        })

        expect(
          await store.transports!.putBindingCheckpoint!({
            checkpoint: written,
            lease: lease!,
          }),
        ).toEqual({ kind: 'accepted' })

        const read = await store.transports!.getBindingCheckpoint!({
          namespace,
          bindingId,
        })
        expect(read).toMatchObject({
          cursor: 'cursor:held',
          status,
          configRef: { id: 'config.orders', revision: 'rev.3' },
        })
        if (status === 'faulted') {
          expect(read?.lastErrorCode).toBe('TRANSPORT_STREAM_TERMINAL')
        }
      }
    })
  }, 60_000)

  it('omitted configRef and status decode without those fields', async () => {
    await withStore(async (store) => {
      const namespace = 'checkpoint-status-omitted'
      const bindingId = 'binding.orders.poll.legacy'
      const resource = bindingLeaseResource(namespace, bindingId)
      const lease = await store.leases.claim(resource, {
        ttlMs: 30_000,
        ownerId: 'worker-a',
      })
      expect(lease).not.toBeNull()

      const legacy = sampleCheckpoint({
        namespace,
        bindingId,
        cursor: 'cursor:legacy',
        lastOwnerId: 'worker-a',
      })
      expect('configRef' in legacy).toBe(false)
      expect('status' in legacy).toBe(false)

      expect(
        await store.transports!.putBindingCheckpoint!({
          checkpoint: legacy,
          lease: lease!,
        }),
      ).toEqual({ kind: 'accepted' })

      const read = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId,
      })
      expect(read).toMatchObject({
        cursor: 'cursor:legacy',
        lastOwnerId: 'worker-a',
      })
      expect(read).not.toHaveProperty('configRef')
      expect(read).not.toHaveProperty('status')
    })
  }, 60_000)

  it('lease fence still rejects stale tokens when stream fields are present', async () => {
    await withStore(async (store) => {
      const namespace = 'checkpoint-status-fence'
      const bindingId = 'binding.orders.stream.fence'
      const resource = bindingLeaseResource(namespace, bindingId)
      const lease = await store.leases.claim(resource, {
        ttlMs: 30_000,
        ownerId: 'worker-a',
      })
      expect(lease).not.toBeNull()

      expect(
        await store.transports!.putBindingCheckpoint!({
          checkpoint: sampleCheckpoint({
            namespace,
            bindingId,
            cursor: 'cursor:1',
            lastOwnerId: 'worker-a',
            configRef: { id: 'config.orders', revision: 'rev.1' },
            status: 'active',
          }),
          lease: lease!,
        }),
      ).toEqual({ kind: 'accepted' })

      const stale: Lease = Object.freeze({
        ...lease!,
        token: 'lease_stale' as LeaseToken,
      })
      expect(
        await store.transports!.putBindingCheckpoint!({
          checkpoint: sampleCheckpoint({
            namespace,
            bindingId,
            cursor: 'cursor:stale',
            lastOwnerId: 'worker-a',
            configRef: { id: 'config.orders', revision: 'rev.1' },
            status: 'faulted',
          }),
          lease: stale,
        }),
      ).toEqual({ kind: 'rejected' })

      await expect(
        store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
      ).resolves.toMatchObject({
        cursor: 'cursor:1',
        status: 'active',
        configRef: { id: 'config.orders', revision: 'rev.1' },
      })
    })
  }, 60_000)

  async function withStore(
    run: (store: PostgresRuntimeStore) => Promise<void>,
  ): Promise<void> {
    const schema = `crux_checkpoint_status_${Date.now()}_${nextSchema++}`
    const pool = createPostgresTestPool(database.url)
    const store = postgres({ pool, schema })
    try {
      await store.setup.apply()
      await run(store)
    } finally {
      await store.close()
      await pool.end()
      const cleanup = createPostgresTestPool(database.url)
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } finally {
        await cleanup.end()
      }
    }
  }
})
