/**
 * PostgreSQL Runtime worker supervises stream transports with durable cursors.
 *
 * Sequential dual-pool fixture pattern (same discipline as polling worker
 * tests) to avoid OOM / connection exhaustion under parallel stress.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { signal } from '@use-crux/core/signal'
import { stream, type StreamItem } from '@use-crux/core/signal/transport'
import {
  managedTransportBinding,
  signalProvider,
} from '@use-crux/core/signal/provider'
import {
  bindingLeaseResource,
  createRuntimeProgram,
  createWorkerTransportSupervision,
  type Lease,
  type LeaseToken,
  type RuntimeTransportBindingCheckpoint,
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

function envelopeItem(options: {
  readonly eventId: string
  readonly cursor?: string | null
}): StreamItem {
  const item: StreamItem = {
    kind: 'envelope',
    accountId: 'acct_1',
    eventId: options.eventId,
    authenticatedRouting: { source: 'stream' },
    payload: inlinePayload(
      JSON.stringify({
        orderId: options.eventId.replace('evt_pg_', 'ord_'),
      }),
    ),
  }
  if (options.cursor !== undefined) {
    return Object.freeze({ ...item, cursor: options.cursor })
  }
  return Object.freeze(item)
}

describe('PostgreSQL Runtime worker stream supervision', () => {
  let database: PostgresTestDatabase
  let nextSchema = 0

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })

  it('opens, accepts, checkpoints, and resumes after restart without redelivery', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'worker-stream'
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

      const openCursors: Array<string | null> = []
      let phase: 'first' | 'second' = 'first'

      const provider = signalProvider({
        id: 'orders.stream',
        transport: stream({
          async open({ cursor, signal: openSignal }) {
            openCursors.push(cursor)
            if (phase === 'first') {
              return (async function* () {
                if (cursor === null) {
                  yield envelopeItem({
                    eventId: 'evt_pg_1',
                    cursor: 'cursor:1',
                  })
                }
                await waitForAbort(openSignal)
              })()
            }
            return (async function* () {
              if (cursor === 'cursor:1') {
                yield envelopeItem({
                  eventId: 'evt_pg_2',
                  cursor: 'cursor:2',
                })
              }
              await waitForAbort(openSignal)
            })()
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
        id: 'binding.orders.stream',
        configRef: { id: 'config.orders.stream', revision: 'rev.1' },
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
            const checkpoint =
              await firstStore.transports!.getBindingCheckpoint!({
                namespace,
                bindingId: binding.id,
              })
            return checkpoint?.cursor
          }, { timeout: 30_000 })
          .toBe('cursor:1')

        const occurrenceId = published[0]!.occurrenceId
        await first.stop()

        phase = 'second'
        const beforeRestart = openCursors.length

        replacement = startWorker(replacementStore, namespace, program)
        await expect
          .poll(() => published.map((entry) => entry.orderId), {
            timeout: 30_000,
          })
          .toEqual(['ord_1', 'ord_2'])
        expect(published[0]!.occurrenceId).toBe(occurrenceId)
        expect(
          openCursors.slice(beforeRestart).some((cursor) => cursor === 'cursor:1'),
        ).toBe(true)
        expect(
          openCursors.slice(beforeRestart).every((cursor) => cursor !== null),
        ).toBe(true)

        const checkpoint = await replacementStore.transports!.getBindingCheckpoint!({
          namespace,
          bindingId: binding.id,
        })
        expect(checkpoint).toMatchObject({
          cursor: 'cursor:2',
          configRef: { id: 'config.orders.stream', revision: 'rev.1' },
          status: 'active',
        })
      } finally {
        await replacement?.stop()
        await first.stop().catch(() => undefined)
      }
    })
  }, 60_000)

  it('atomically rejects stale stream binding checkpoint fences', async () => {
    await withStores(async ({ firstStore: store }) => {
      const namespace = 'worker-stream-fence'
      const bindingId = 'binding.orders.stream.fence'
      const resource = bindingLeaseResource(namespace, bindingId)
      const lease = await store.leases.claim(resource, {
        ttlMs: 30_000,
        ownerId: 'worker-a',
      })
      expect(lease).not.toBeNull()

      const accepted = await store.transports!.putBindingCheckpoint!({
        checkpoint: sampleCheckpoint({
          namespace,
          bindingId,
          cursor: 'cursor:1',
          lastOwnerId: 'worker-a',
          configRef: { id: 'config.orders.stream', revision: 'rev.1' },
          status: 'active',
        }),
        lease: lease!,
      })
      expect(accepted).toEqual({ kind: 'accepted' })
      await expect(
        store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
      ).resolves.toMatchObject({
        cursor: 'cursor:1',
        configRef: { id: 'config.orders.stream', revision: 'rev.1' },
        status: 'active',
      })

      const wrongToken: Lease = Object.freeze({
        ...lease!,
        token: 'lease_stale' as LeaseToken,
      })
      expect(
        await store.transports!.putBindingCheckpoint!({
          checkpoint: sampleCheckpoint({
            namespace,
            bindingId,
            cursor: 'cursor:stale-token',
            lastOwnerId: 'worker-a',
            configRef: { id: 'config.orders.stream', revision: 'rev.1' },
            status: 'active',
          }),
          lease: wrongToken,
        }),
      ).toEqual({ kind: 'rejected' })

      await store.leases.release(lease!)

      expect(
        await store.transports!.putBindingCheckpoint!({
          checkpoint: sampleCheckpoint({
            namespace,
            bindingId,
            cursor: 'cursor:after-release',
            lastOwnerId: 'worker-a',
            configRef: { id: 'config.orders.stream', revision: 'rev.1' },
            status: 'active',
          }),
          lease: lease!,
        }),
      ).toEqual({ kind: 'rejected' })

      await expect(
        store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
      ).resolves.toMatchObject({ cursor: 'cursor:1' })
    })
  }, 60_000)

  it('coordinates competing stream supervisors so only one opens', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'worker-stream-lease'
      const orderSubmitted = signal({
        id: 'order.submitted',
        schema: z.object({ orderId: z.string() }),
      })
      let openCount = 0

      const provider = signalProvider({
        id: 'orders.stream',
        transport: stream({
          async open({ signal: openSignal }) {
            openCount += 1
            return (async function* () {
              yield envelopeItem({
                eventId: 'evt_pg_lease',
                cursor: 'cursor:lease',
              })
              await waitForAbort(openSignal)
            })()
          },
        }),
        signals: { orderSubmitted },
        async onEvent() {
          // Accept-path only; drain is not required for exclusivity.
        },
      })
      const binding = managedTransportBinding(provider, {
        id: 'binding.orders.stream.lease',
        configRef: { id: 'config.orders.stream.lease', revision: 'rev.1' },
        signalId: 'order.submitted',
      })
      const program = createRuntimeProgram({
        targets: [],
        providers: [provider],
        transports: [binding],
      })

      const first = createWorkerTransportSupervision({
        program,
        store: firstStore,
        namespace,
        ownerId: 'worker-a',
      })!
      const second = createWorkerTransportSupervision({
        program,
        store: replacementStore,
        namespace,
        ownerId: 'worker-b',
      })!

      try {
        const signalAbort = new AbortController().signal
        const [left, right] = await Promise.all([
          first.runOnce(signalAbort, new Date()),
          second.runOnce(signalAbort, new Date()),
        ])

        await expect.poll(() => openCount, { timeout: 30_000 }).toBe(1)

        const opened = [left, right].reduce(
          (sum, result) => sum + (result.streamOpened ?? 0),
          0,
        )
        expect(opened).toBe(1)
        expect(
          [left, right].filter((result) => result.skipped > 0).length,
        ).toBeGreaterThanOrEqual(1)

        await expect
          .poll(async () => {
            const envelope = await firstStore.transports!.get({
              namespace,
              provider: 'orders.stream',
              accountId: 'acct_1',
              eventId: 'evt_pg_lease',
            })
            return envelope?.state
          }, { timeout: 30_000 })
          .toBe('accepted')

        const lease = await firstStore.leases.claim(
          bindingLeaseResource(namespace, binding.id),
          { ttlMs: 1_000, ownerId: 'intruder' },
        )
        expect(lease).toBeNull()
      } finally {
        await first.dispose()
        await second.dispose()
      }
    })
  }, 60_000)

  async function withStores(
    run: (stores: {
      readonly firstStore: PostgresRuntimeStore
      readonly replacementStore: PostgresRuntimeStore
    }) => Promise<void>,
  ): Promise<void> {
    const schema = `crux_worker_stream_${Date.now()}_${nextSchema++}`
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

function sampleCheckpoint(options: {
  readonly namespace: string
  readonly bindingId: string
  readonly cursor: string | null
  readonly lastOwnerId?: string
  readonly configRef?: RuntimeTransportBindingCheckpoint['configRef']
  readonly status?: RuntimeTransportBindingCheckpoint['status']
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
    ...(options.configRef !== undefined ? { configRef: options.configRef } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  })
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}
