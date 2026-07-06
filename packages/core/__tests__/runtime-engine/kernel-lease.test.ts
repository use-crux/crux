import { describe, expect, it, vi } from 'vitest'
import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import {
  createRuntimeKernel,
  wakeEnvelopeForWork,
} from '../../runtime/engine/kernel'
import type { RuntimeTargetId, TaskId, WorkId } from '../../runtime/ports'

describe('RuntimeKernel lease fencing', () => {
  it('rejects a stale final commit after maintenance reclaims the lease', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      let executions = 0
      let releaseFirst!: () => void
      let resolveFirstStarted!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        resolveFirstStarted = resolve
      })
      const firstCanFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })

      const targetId = 'embed-document' as RuntimeTargetId
      const kernel = createRuntimeKernel({
        store,
        targets: {
          [targetId]: {
            targetId,
            kind: 'task',
            execute: async () => {
              executions += 1
              if (executions === 1) {
                resolveFirstStarted()
                await firstCanFinish
                return {
                  status: 'blocked',
                  error: {
                    code: 'FIRST_WORKER_STALE',
                    message: 'first worker should not commit',
                    at: new Date('2026-07-02T00:00:02.000Z'),
                  },
                }
              }
              return { status: 'completed' }
            },
          },
        },
        newWorkId: () => 'work_task_1' as WorkId,
        leaseTtlMs: 1_000,
        leaseExtension: false,
      })
      const enqueued = await kernel.enqueueTask({
        namespace: 'tenant-a',
        taskId: 'task_1' as TaskId,
        targetId,
      })
      const envelope = wakeEnvelopeForWork(enqueued)

      const staleWake = kernel.handleWake(envelope)
      await firstStarted

      vi.advanceTimersByTime(1_001)
      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date('2026-07-02T00:00:01.001Z'),
        }),
      ).resolves.toMatchObject({ leasesReclaimed: 1 })

      await expect(kernel.handleWake(envelope)).resolves.toEqual({
        status: 200,
        outcome: 'processed',
      })

      releaseFirst()
      await expect(staleWake).resolves.toEqual({
        status: 200,
        outcome: 'lease-lost',
      })
      await expect(
        store.state.getWork(enqueued.workId, { namespace: 'tenant-a' }),
      ).resolves.toMatchObject({
        status: 'completed',
        lastError: undefined,
      })
      await expect(
        store.state.hasIdempotencyKey('tenant-a', 'task:work_task_1'),
      ).resolves.toBe(true)
      expect(executions).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('extends the active lease on the configured heartbeat schedule', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      let releaseTarget!: () => void
      let resolveStarted!: () => void
      let beat!: () => void
      let cancelled = false
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve
      })
      const targetCanFinish = new Promise<void>((resolve) => {
        releaseTarget = resolve
      })
      const originalExtend = store.leases.extend.bind(store.leases)
      let extendedToken: string | undefined
      const extended = new Promise<void>((resolve) => {
        ;(store.leases as unknown as typeof store.leases & {
          extend: typeof store.leases.extend
        }).extend = async (lease, ttlMs) => {
          const refreshed = await originalExtend(lease, ttlMs)
          extendedToken = refreshed.token
          resolve()
          return refreshed
        }
      })
      const targetId = 'embed-document' as RuntimeTargetId
      const kernel = createRuntimeKernel({
        store,
        targets: {
          [targetId]: {
            targetId,
            kind: 'task',
            execute: async () => {
              resolveStarted()
              await targetCanFinish
              return { status: 'completed' }
            },
          },
        },
        newWorkId: () => 'work_task_1' as WorkId,
        leaseTtlMs: 900,
        leaseExtension: {
          schedule(fn, intervalMs) {
            expect(intervalMs).toBe(300)
            beat = fn
            return () => {
              cancelled = true
            }
          },
        },
      })
      const enqueued = await kernel.enqueueTask({
        namespace: 'tenant-a',
        taskId: 'task_1' as TaskId,
        targetId,
      })

      const wake = kernel.handleWake(wakeEnvelopeForWork(enqueued))
      await started
      const leased = await store.state.getWork(enqueued.workId, {
        namespace: 'tenant-a',
      })
      expect(leased?.status).toBe('leased')

      vi.advanceTimersByTime(500)
      beat()
      await extended
      expect(extendedToken).toBe(leased?.leaseToken)

      vi.advanceTimersByTime(600)
      await expect(
        store.leases.claim(`work:${enqueued.workId}`, { ttlMs: 900 }),
      ).resolves.toBeNull()

      releaseTarget()
      await expect(wake).resolves.toEqual({
        status: 200,
        outcome: 'processed',
      })
      expect(cancelled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs heartbeat failures without failing the running target', async () => {
    const store = inMemoryRuntimeStore()
    let releaseTarget!: () => void
    let resolveStarted!: () => void
    let beat!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const targetCanFinish = new Promise<void>((resolve) => {
      releaseTarget = resolve
    })
    const attempted = new Promise<void>((resolve) => {
      ;(store.leases as unknown as typeof store.leases & {
        extend: typeof store.leases.extend
      }).extend = async () => {
        resolve()
        throw new Error('lease store unavailable')
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const targetId = 'embed-document' as RuntimeTargetId
      const kernel = createRuntimeKernel({
        store,
        targets: {
          [targetId]: {
            targetId,
            kind: 'task',
            execute: async () => {
              resolveStarted()
              await targetCanFinish
              return { status: 'completed' }
            },
          },
        },
        newWorkId: () => 'work_task_1' as WorkId,
        leaseExtension: {
          schedule(fn) {
            beat = fn
            return () => {}
          },
        },
      })
      const enqueued = await kernel.enqueueTask({
        namespace: 'tenant-a',
        taskId: 'task_1' as TaskId,
        targetId,
      })

      const wake = kernel.handleWake(wakeEnvelopeForWork(enqueued))
      await started
      beat()
      await attempted
      await Promise.resolve()

      releaseTarget()
      await expect(wake).resolves.toEqual({
        status: 200,
        outcome: 'processed',
      })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('lease heartbeat failed'),
        expect.any(Error),
      )
    } finally {
      warn.mockRestore()
    }
  })
})
