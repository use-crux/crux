import { describe, expect, it } from 'vitest'
import {
  CruxRuntimeError,
  createRuntimeProgram,
  createRuntimeWorker,
  durableTask,
  inMemoryRuntimeStore,
  node,
  type TaskId,
} from '@use-crux/core/runtime'

describe('createRuntimeWorker', () => {
  it('starts maintenance and executes queued targets declared by the program', async () => {
    const seen: string[] = []
    const target = durableTask('worker-allowlisted', {
      run: (input: { value: string }) => {
        seen.push(input.value)
      },
    })
    const worker = createRuntimeWorker({
      runtime: node({
        store: inMemoryRuntimeStore(),
        namespace: 'worker-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [target], transports: [] }),
      pollIntervalMs: 5,
    })

    await worker.runtime.kernel.enqueueTask({
      namespace: 'worker-test',
      taskId: 'task_worker_allowlisted' as TaskId,
      targetId: target.targetId,
      input: { value: 'executed' },
    })

    await expect.poll(() => seen).toEqual(['executed'])
    await worker.stop()
    await expect(worker.closed).resolves.toBeUndefined()
  })

  it('never executes a registered target absent from the program', async () => {
    let executed = false
    const unlisted = durableTask('worker-unlisted', {
      run: () => {
        executed = true
      },
    })
    const worker = createRuntimeWorker({
      runtime: node({
        store: inMemoryRuntimeStore(),
        namespace: 'worker-unlisted-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
      pollIntervalMs: 5,
    })

    await worker.runtime.kernel.enqueueTask({
      namespace: 'worker-unlisted-test',
      taskId: 'task_worker_unlisted' as TaskId,
      targetId: unlisted.targetId,
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(executed).toBe(false)
    await worker.stop()
  })

  it('serializes maintenance ticks and stops idempotently', async () => {
    const memory = inMemoryRuntimeStore()
    const claimPending = memory.outbox.claimPending.bind(memory.outbox)
    let active = 0
    let calls = 0
    let maximumActive = 0
    const store = {
      ...memory,
      outbox: {
        ...memory.outbox,
        async claimPending(options: Parameters<typeof claimPending>[0]) {
          calls += 1
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await new Promise((resolve) => setTimeout(resolve, 10))
          active -= 1
          return await claimPending(options)
        },
      },
    }
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: 'worker-serial-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
      pollIntervalMs: 1,
    })

    await expect.poll(() => calls).toBeGreaterThanOrEqual(2)
    expect(maximumActive).toBe(1)

    const firstStop = worker.stop()
    const secondStop = worker.stop()
    expect(firstStop).toBe(secondStop)
    await firstStop
    await expect(worker.closed).resolves.toBeUndefined()
  })

  it('waits for durable ownership and releases it when stopped during acquisition', async () => {
    const memory = inMemoryRuntimeStore()
    const acquisition = deferred<{
      readonly acquired: true
      readonly release: () => Promise<void>
    }>()
    let acquisitionCalls = 0
    let maintenanceCalls = 0
    let releaseCalls = 0
    const claimPending = memory.outbox.claimPending.bind(memory.outbox)
    const store = {
      ...memory,
      maintenanceOwnership: {
        acquire: async () => {
          acquisitionCalls += 1
          return await acquisition.promise
        },
      },
      outbox: {
        ...memory.outbox,
        async claimPending(options: Parameters<typeof claimPending>[0]) {
          maintenanceCalls += 1
          return await claimPending(options)
        },
      },
    }
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: 'worker-async-owner-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
    })

    await expect.poll(() => acquisitionCalls).toBe(1)
    expect(maintenanceCalls).toBe(0)
    const stopping = worker.stop()
    acquisition.resolve({
      acquired: true,
      async release() {
        releaseCalls += 1
      },
    })

    await stopping
    expect(maintenanceCalls).toBe(0)
    expect(releaseCalls).toBe(1)
    await expect(worker.closed).resolves.toBeUndefined()
  })

  it('closes without maintenance when durable ownership is unavailable', async () => {
    let owned = false
    const maintenanceOwnership = {
      async acquire() {
        if (owned) return { acquired: false as const }
        owned = true
        return {
          acquired: true as const,
          async release() {
            owned = false
          },
        }
      },
    }
    const firstStore = inMemoryRuntimeStore()
    const duplicateStore = inMemoryRuntimeStore()
    let duplicateMaintenanceCalls = 0
    const duplicateClaimPending =
      duplicateStore.outbox.claimPending.bind(duplicateStore.outbox)
    const first = createRuntimeWorker({
      runtime: node({
        store: { ...firstStore, maintenanceOwnership },
        namespace: 'worker-durable-duplicate-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
      pollIntervalMs: 100,
    })
    await expect.poll(() => owned).toBe(true)
    const duplicate = createRuntimeWorker({
      runtime: node({
        store: {
          ...duplicateStore,
          maintenanceOwnership,
          outbox: {
            ...duplicateStore.outbox,
            async claimPending(
              options: Parameters<typeof duplicateClaimPending>[0],
            ) {
              duplicateMaintenanceCalls += 1
              return await duplicateClaimPending(options)
            },
          },
        },
        namespace: 'worker-durable-duplicate-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
    })

    await expect(duplicate.closed).rejects.toBeInstanceOf(CruxRuntimeError)
    await expect(duplicate.closed).rejects.toThrow(
      /ownership.*already held.*worker-durable-duplicate-test/i,
    )
    expect(duplicateMaintenanceCalls).toBe(0)
    await first.stop()
  })

  it('treats durable ownership acquisition errors as fatal and releases local ownership', async () => {
    const memory = inMemoryRuntimeStore()
    const failure = new Error('ownership backend unavailable')
    let shouldFail = true
    const store = {
      ...memory,
      maintenanceOwnership: {
        async acquire() {
          if (shouldFail) {
            shouldFail = false
            throw failure
          }
          return {
            acquired: true as const,
            async release() {},
          }
        },
      },
    }
    const runtime = node({
      store,
      namespace: 'worker-owner-failure-test',
      autoStartMaintenance: false,
    })
    const program = createRuntimeProgram({ targets: [], transports: [] })
    const worker = createRuntimeWorker({ runtime, program })

    await expect(worker.closed).rejects.toBe(failure)
    const replacement = createRuntimeWorker({ runtime, program })
    await replacement.stop()
  })

  it('closes fatally when durable ownership release fails', async () => {
    const failure = new Error('ownership release failed')
    const memory = inMemoryRuntimeStore()
    const claimPending = memory.outbox.claimPending.bind(memory.outbox)
    let maintenanceCalls = 0
    const worker = createRuntimeWorker({
      runtime: node({
        store: {
          ...memory,
          maintenanceOwnership: {
            async acquire() {
              return {
                acquired: true as const,
                async release() {
                  throw failure
                },
              }
            },
          },
          outbox: {
            ...memory.outbox,
            async claimPending(options: Parameters<typeof claimPending>[0]) {
              maintenanceCalls += 1
              return await claimPending(options)
            },
          },
        },
        namespace: 'worker-owner-release-failure-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
    })

    await expect.poll(() => maintenanceCalls).toBe(1)
    await expect(worker.stop()).rejects.toBe(failure)
    await expect(worker.closed).rejects.toBe(failure)
  })

  it('bounds stop while reporting that an active tick was not cancelled', async () => {
    const memory = inMemoryRuntimeStore()
    const activeTick = deferred<void>()
    let entered = false
    let releaseCalls = 0
    const store = {
      ...memory,
      maintenanceOwnership: {
        async acquire() {
          return {
            acquired: true as const,
            async release() {
              releaseCalls += 1
            },
          }
        },
      },
      outbox: {
        ...memory.outbox,
        claimPending: async () => {
          entered = true
          await activeTick.promise
          return []
        },
      },
    }
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: 'worker-stop-timeout-test',
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [], transports: [] }),
    })
    await expect.poll(() => entered).toBe(true)

    const stopping = worker.stop({ timeoutMs: 5 })
    await expect(stopping).rejects.toBeInstanceOf(CruxRuntimeError)
    await expect(stopping).rejects.toThrow(
      /active maintenance tick.*not.*cancelled/i,
    )
    await expect(worker.closed).rejects.toBeInstanceOf(CruxRuntimeError)
    expect(releaseCalls).toBe(0)

    activeTick.resolve()
    await expect.poll(() => releaseCalls).toBe(1)
    expect(worker.stop()).toBe(stopping)
    expect(releaseCalls).toBe(1)
  }, 200)

  it('rejects a duplicate store and namespace owner before it executes maintenance', async () => {
    const memory = inMemoryRuntimeStore()
    const claimPending = memory.outbox.claimPending.bind(memory.outbox)
    let maintenanceCalls = 0
    const store = {
      ...memory,
      outbox: {
        ...memory.outbox,
        async claimPending(options: Parameters<typeof claimPending>[0]) {
          maintenanceCalls += 1
          return await claimPending(options)
        },
      },
    }
    const runtime = node({
      store,
      namespace: 'worker-owner-test',
      autoStartMaintenance: false,
    })
    const program = createRuntimeProgram({ targets: [], transports: [] })
    const worker = createRuntimeWorker({
      runtime,
      program,
      pollIntervalMs: 100,
    })
    await expect.poll(() => maintenanceCalls).toBe(1)
    let duplicate: ReturnType<typeof createRuntimeWorker> | undefined

    expect(() => {
      duplicate = createRuntimeWorker({
        runtime,
        program,
        pollIntervalMs: 100,
      })
    }).toThrow(CruxRuntimeError)
    expect(maintenanceCalls).toBe(1)

    await duplicate?.stop()
    await worker.stop()

    const restarted = createRuntimeWorker({
      runtime,
      program,
      pollIntervalMs: 100,
    })
    await restarted.stop()
  })

  it('closes on fatal maintenance failure and releases ownership', async () => {
    const memory = inMemoryRuntimeStore()
    const claimPending = memory.outbox.claimPending.bind(memory.outbox)
    const failure = new Error('store maintenance failed')
    let shouldFail = true
    let releaseCalls = 0
    const store = {
      ...memory,
      maintenanceOwnership: {
        async acquire() {
          return {
            acquired: true as const,
            async release() {
              releaseCalls += 1
            },
          }
        },
      },
      outbox: {
        ...memory.outbox,
        async claimPending(options: Parameters<typeof claimPending>[0]) {
          if (shouldFail) {
            shouldFail = false
            throw failure
          }
          return await claimPending(options)
        },
      },
    }
    const runtime = node({
      store,
      namespace: 'worker-fatal-test',
      autoStartMaintenance: false,
    })
    const program = createRuntimeProgram({ targets: [], transports: [] })
    const worker = createRuntimeWorker({ runtime, program })

    await expect(worker.closed).rejects.toBe(failure)
    expect(releaseCalls).toBe(1)
    const restarted = createRuntimeWorker({ runtime, program })
    await restarted.stop()
    expect(releaseCalls).toBe(2)
  })
})

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
