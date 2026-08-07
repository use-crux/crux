/**
 * PostgreSQL Runtime worker supervises polling transports with durable cursors.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { signal } from '@use-crux/core/signal'
import { polling } from '@use-crux/core/signal/transport'
import {
  managedTransportBinding,
  signalProvider,
} from '@use-crux/core/signal/provider'
import {
  createRuntimeProgram,
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

describe('PostgreSQL Runtime worker polling supervision', () => {
  let database: PostgresTestDatabase
  let nextSchema = 0

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })

  it('polls, checkpoints, and resumes after restart without redelivery', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'worker-poll'
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

      let pages = new Map<string | null, { events: string[]; next: string | null }>([
        [null, { events: ['evt_pg_1'], next: 'cursor:1' }],
        ['cursor:1', { events: [], next: 'cursor:1' }],
      ])
      const pollCursors: Array<string | null> = []

      const provider = signalProvider({
        id: 'orders.poll',
        transport: polling({
          async poll({ cursor }) {
            pollCursors.push(cursor)
            const page = pages.get(cursor) ?? { events: [], next: cursor }
            return {
              events: page.events.map((eventId) => ({
                accountId: 'acct_1',
                eventId,
                authenticatedRouting: { source: 'polling' },
                payload: inlinePayload(
                  JSON.stringify({ orderId: eventId.replace('evt_pg_', 'ord_') }),
                ),
              })),
              nextCursor: page.next,
            }
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
        },
      })
      const binding = managedTransportBinding(provider, {
        id: 'binding.orders.poll',
        configRef: { id: 'config.orders.poll', revision: 'rev.1' },
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
        await expect
          .poll(() => published.map((entry) => entry.orderId), {
            timeout: 30_000,
          })
          .toEqual(['ord_1'])
        await expect
          .poll(async () => {
            const checkpoint = await firstStore.transports!.getBindingCheckpoint!({
              namespace,
              bindingId: binding.id,
            })
            return checkpoint?.cursor
          }, { timeout: 30_000 })
          .toBe('cursor:1')

        const occurrenceId = published[0]!.occurrenceId
        await first.stop()

        pages = new Map([
          ['cursor:1', { events: ['evt_pg_2'], next: 'cursor:2' }],
          ['cursor:2', { events: [], next: 'cursor:2' }],
        ])
        const beforeRestart = pollCursors.length

        replacement = startWorker(replacementStore, namespace, program)
        await expect
          .poll(() => published.map((entry) => entry.orderId), {
            timeout: 30_000,
          })
          .toEqual(['ord_1', 'ord_2'])
        expect(published[0]!.occurrenceId).toBe(occurrenceId)
        expect(
          pollCursors.slice(beforeRestart).some((cursor) => cursor === 'cursor:1'),
        ).toBe(true)
        expect(
          pollCursors.slice(beforeRestart).every((cursor) => cursor !== null),
        ).toBe(true)
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
    const schema = `crux_worker_poll_${Date.now()}_${nextSchema++}`
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
