/**
 * PostgreSQL Runtime worker drains accepted transport envelopes with restart safety.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { signal } from '@use-crux/core/signal'
import { webhook } from '@use-crux/core/signal/transport'
import {
  managedTransportBinding,
  signalProvider,
} from '@use-crux/core/signal/provider'
import {
  acceptTransportEnvelope,
  createRuntimeProgram,
  type RuntimeAcceptedTransportEnvelope,
  type RuntimeWorker,
} from '@use-crux/core/runtime'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'
import { startWorker } from './runtime-worker-restart-fixture'

function inlinePayload(text: string) {
  const bytes = new TextEncoder().encode(text)
  return {
    kind: 'inline-base64url' as const,
    value: Buffer.from(bytes).toString('base64url'),
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function makeEnvelope(
  binding: ReturnType<typeof managedTransportBinding>,
  eventId: string,
): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: 'RuntimeAcceptedTransportEnvelope',
    schemaVersion: 1,
    bindingId: binding.id,
    adapterId: binding.adapter.id,
    provider: binding.adapter.provider,
    accountId: 'acct_1',
    eventId,
    receivedAt: '2026-08-04T12:00:00.000Z',
    authenticatedRouting: { source: 'webhook' },
    payload: inlinePayload(JSON.stringify({ orderId: 'ord_1' })),
    configRef: binding.configRef,
    target: binding.target,
  }
}

describe('PostgreSQL Runtime worker transport drain', () => {
  let database: PostgresTestDatabase
  let nextSchema = 0

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })

  it('normalizes an accepted envelope and does not redeliver after restart', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'worker-transport'
      const orderSubmitted = signal({
        id: 'order.submitted',
        schema: z.object({ orderId: z.string() }),
      })
      const published: Array<{ orderId: string; occurrenceId: string }> = []
      orderSubmitted.subscribe((occurrence) => {
        published.push({
          orderId: occurrence.payload.orderId,
          occurrenceId: occurrence.id,
        })
      })

      let failAfterPublish = false
      const provider = signalProvider({
        id: 'orders.webhook',
        transport: webhook({
          async handle() {
            throw new Error('edge not used')
          },
        }),
        signals: { orderSubmitted },
        async onEvent(envelope, { signals }) {
          const raw =
            envelope.payload.kind === 'inline-base64url'
              ? Buffer.from(envelope.payload.value, 'base64url').toString('utf8')
              : ''
          const body = JSON.parse(raw) as { orderId: string }
          await signals.orderSubmitted.publish({ orderId: body.orderId })
          if (failAfterPublish) {
            throw new Error('crash after publish')
          }
        },
      })
      const binding = managedTransportBinding(provider, {
        id: 'binding.orders',
        configRef: { id: 'config.orders', revision: 'rev.1' },
        signalId: 'order.submitted',
      })
      const program = createRuntimeProgram({
        targets: [],
        providers: [provider],
        transports: [binding],
      })

      const first = startWorker(firstStore, namespace, program)
      let replacement: RuntimeWorker<PostgresRuntimeStore> | undefined
      try {
        const accept = await acceptTransportEnvelope({
          store: firstStore,
          namespace,
          envelope: makeEnvelope(binding, 'evt_pg_worker'),
          now: new Date('2026-08-04T12:00:00.000Z'),
        })
        expect(accept.acknowledge).toBe(true)

        await expect
          .poll(() => published.map((entry) => entry.orderId), {
            timeout: 30_000,
          })
          .toEqual(['ord_1'])
        await expect
          .poll(async () => {
            const record = await firstStore.transports!.get({
              namespace,
              provider: 'orders.webhook',
              accountId: 'acct_1',
              eventId: 'evt_pg_worker',
            })
            return record?.state
          })
          .toBe('normalized')

        const occurrenceId = published[0]!.occurrenceId
        await first.stop()

        const again = await acceptTransportEnvelope({
          store: replacementStore,
          namespace,
          envelope: makeEnvelope(binding, 'evt_pg_worker'),
        })
        expect(again.kind).toBe('duplicate')

        replacement = startWorker(replacementStore, namespace, program)
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(published).toHaveLength(1)
        expect(published[0]!.occurrenceId).toBe(occurrenceId)

        // Crash after publish, then recover without a second logical delivery.
        failAfterPublish = true
        await acceptTransportEnvelope({
          store: replacementStore,
          namespace,
          envelope: makeEnvelope(binding, 'evt_pg_crash'),
          maxAttempts: 4,
        })
        await expect.poll(() => published.length, { timeout: 30_000 }).toBe(2)
        const crashOccurrence = published[1]!.occurrenceId
        failAfterPublish = false
        await expect
          .poll(
            async () => {
              const record = await replacementStore.transports!.get({
                namespace,
                provider: 'orders.webhook',
                accountId: 'acct_1',
                eventId: 'evt_pg_crash',
              })
              return record?.state
            },
            { timeout: 30_000, interval: 50 },
          )
          .toBe('normalized')
        expect(published).toHaveLength(2)
        expect(published[1]!.occurrenceId).toBe(crashOccurrence)
      } finally {
        await replacement?.stop()
        await first.stop().catch(() => undefined)
      }
    })
  }, 60_000)

  async function withStores(
    run: (stores: {
      readonly firstStore: PostgresRuntimeStore
      readonly replacementStore: PostgresRuntimeStore
    }) => Promise<void>,
  ): Promise<void> {
    const schema = `crux_worker_transport_${Date.now()}_${nextSchema++}`
    const firstPool = createPostgresTestPool(database.url)
    const replacementPool = createPostgresTestPool(database.url)
    const firstStore = postgres({ pool: firstPool, schema })
    const replacementStore = postgres({ pool: replacementPool, schema })
    try {
      await firstStore.setup.apply()
      await run({ firstStore, replacementStore })
    } finally {
      await Promise.all([firstStore.close(), replacementStore.close()])
      await Promise.all([firstPool.end(), replacementPool.end()])
      const cleanup = createPostgresTestPool(database.url)
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } finally {
        await cleanup.end()
      }
    }
  }
})
