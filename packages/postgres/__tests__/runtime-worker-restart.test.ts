import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import {
  createRuntimeProgram,
  durableTask,
  node,
  type FlowId,
  type RuntimeWorker,
  type TaskId,
} from '@use-crux/core/runtime'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'
import {
  startSettledWorker,
  startWorker,
  taskWork,
} from './runtime-worker-restart-fixture'

describe('PostgreSQL Runtime worker restart recovery', () => {
  let database: PostgresTestDatabase
  let nextSchema = 0

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await database?.close()
  })
  it('completes queued durable work exactly once', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'restart-queue'
      const executions: string[] = []
      const target = durableTask('restart-queued-task', {
        run(input: { value: string }) {
          executions.push(input.value)
          return input.value
        },
      })
      const program = createRuntimeProgram({ targets: [target], transports: [] })
      const first = await startSettledWorker(firstStore, namespace, program)
      let replacement: RuntimeWorker<PostgresRuntimeStore> | undefined
      try {
        const work = await first.runtime.kernel.enqueueTask({
          namespace,
          taskId: 'task_restart_queued' as TaskId,
          targetId: target.targetId,
          input: { value: 'durable' },
        })
        await expect(
          firstStore.state.getWork(work.workId, { namespace }),
        ).resolves.toMatchObject({ status: 'pending' })
        await expect(
          firstStore.outbox.listByWork(work.workId, { namespace }),
        ).resolves.toEqual([
          expect.objectContaining({
            state: 'pending',
            envelope: expect.objectContaining({ workId: work.workId }),
          }),
        ])
        await first.stop()
        replacement = startWorker(replacementStore, namespace, program)
        await expect.poll(() => executions).toEqual(['durable'])
        await expect.poll(async () =>
          await replacementStore.state.getWork(work.workId, { namespace }),
        ).toMatchObject({ status: 'completed' })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(executions).toEqual(['durable'])
      } finally {
        await replacement?.stop()
        await first.stop().catch(() => undefined)
      }
    })
  })
  it('redispatches an unconfirmed terminal wake without executing again', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'restart-terminal-confirm'
      let executions = 0
      const target = durableTask('restart-terminal-result', {
        run() {
          executions += 1
        },
      })
      const program = createRuntimeProgram({ targets: [target], transports: [] })
      const first = await startSettledWorker(firstStore, namespace, program)
      let replacement: RuntimeWorker<PostgresRuntimeStore> | undefined
      try {
        const work = await first.runtime.kernel.enqueueTask({
          namespace,
          taskId: 'task_restart_terminal' as TaskId,
          targetId: target.targetId,
        })
        firstStore.testing.crashBeforeConfirm()
        await expect(first.runtime.dispatcher.nudge()).resolves.toEqual({
          delivered: 0,
          failed: 1,
        })
        const committed = await firstStore.state.getWork(work.workId, {
          namespace,
        })
        expect(committed).toMatchObject({ status: 'completed' })
        if (!committed) throw new Error('Expected committed terminal work.')
        await expect(
          firstStore.outbox.listByWork(work.workId, { namespace }),
        ).resolves.toEqual([
          expect.objectContaining({ state: 'pending', attempts: 1 }),
        ])
        await first.stop()
        replacement = startWorker(replacementStore, namespace, program)
        await expect.poll(async () =>
          await replacementStore.outbox.listByWork(work.workId, { namespace }),
          { timeout: 5_000 },
        ).toEqual([
          expect.objectContaining({ state: 'confirmed', attempts: 2 }),
        ])
        expect(executions).toBe(1)
        await expect(
          replacementStore.state.getWork(work.workId, { namespace }),
        ).resolves.toEqual(committed)
        await expect(
          replacementStore.state.listWork({ namespace, status: 'completed' }),
        ).resolves.toEqual([committed])
      } finally {
        await replacement?.stop()
        await first.stop().catch(() => undefined)
      }
    })
  })
  it('completes a suspended Flow continuation exactly once', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'restart-flow'
      const steps: string[] = []
      const firstRuntime = node({
        store: firstStore,
        namespace,
        autoStartMaintenance: false,
      })
      const crux = config({ runtime: firstRuntime })
      const review = flow('restart-review', async (scope) => {
        await scope.step('draft', () => steps.push('draft'))
        await scope.suspend('approval')
        await scope.step('publish', () => steps.push('publish'))
      })
      const program = createRuntimeProgram({ targets: [review], transports: [] })
      let replacement: RuntimeWorker<PostgresRuntimeStore> | undefined
      try {
        const suspended = await review.run()
        expect(steps).toEqual(['draft'])
        await review.signal(suspended.flowId, 'approval', {}, { resume: false })
        const snapshot = await firstStore.state.getSnapshot(
          suspended.flowId as FlowId,
          { namespace },
        )
        expect(snapshot).toMatchObject({ status: 'suspended' })
        if (!snapshot) throw new Error('Expected suspended Flow snapshot.')
        await expect(
          firstStore.state.getWork(snapshot.workId, { namespace }),
        ).resolves.toMatchObject({ status: 'pending' })
        await expect(
          firstStore.outbox.listByWork(snapshot.workId, { namespace }),
        ).resolves.toEqual([
          expect.objectContaining({ state: 'pending', attempts: 0 }),
        ])
        crux.dispose()
        replacement = startWorker(replacementStore, namespace, program)

        await expect.poll(() => steps).toEqual(['draft', 'publish'])
        await expect.poll(async () =>
          await replacementStore.state.getSnapshot(suspended.flowId as FlowId, {
            namespace,
          }),
        ).toMatchObject({ status: 'completed' })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(steps).toEqual(['draft', 'publish'])
      } finally {
        await replacement?.stop()
        crux.dispose()
      }
    })
  })

  it('runs due maintenance left by the stopped worker', async () => {
    await withStores(async ({ firstStore, replacementStore }) => {
      const namespace = 'restart-maintenance'
      const executions: string[] = []
      const target = durableTask('restart-maintenance-task', {
        run(input: { category: string }) {
          executions.push(input.category)
        },
      })
      const program = createRuntimeProgram({ targets: [target], transports: [] })
      const first = await startSettledWorker(firstStore, namespace, program)
      await first.stop()
      const expired = await first.runtime.kernel.enqueueTask({
        namespace,
        taskId: 'task_restart_expired' as TaskId,
        targetId: target.targetId,
        input: { category: 'expired-lease' },
      })
      const lease = await firstStore.leases.claim(`work:${expired.workId}`, {
        ttlMs: 1,
      })
      if (!lease) throw new Error('Expected test lease acquisition.')
      await firstStore.state.putWork({
        ...expired,
        status: 'leased',
        leaseToken: lease.token,
      })
      await firstStore.timers.put({
        namespace,
        fireAt: new Date(0),
        work: taskWork('task_restart_timer', target.targetId, 'timer'),
      })
      await firstStore.waiters.register({
        namespace,
        eventName: 'restart.timeout',
        match: {},
        timeoutAt: new Date(0),
        work: taskWork('task_restart_waiter', target.targetId, 'waiter'),
      })
      const idle = await first.runtime.kernel.enqueueTask({
        namespace,
        taskId: 'task_restart_idle' as TaskId,
        targetId: target.targetId,
        idleScope: 'restart-scope',
        input: { category: 'scoped-idle' },
      })
      const retained = await first.runtime.kernel.enqueueTask({
        namespace,
        taskId: 'task_restart_retention' as TaskId,
        targetId: target.targetId,
        input: { category: 'must-not-run' },
      })
      await firstStore.state.putWork({
        ...retained,
        status: 'completed',
        updatedAt: new Date(0),
      })
      await new Promise((resolve) => setTimeout(resolve, 5))

      const replacement = startWorker(replacementStore, namespace, program, {
        terminalWork: 0,
        sweepLimit: 50,
      })
      try {
        await expect.poll(() => [...executions].sort()).toEqual(
          ['expired-lease', 'scoped-idle', 'timer', 'waiter'].sort(),
        )
        await expect(
          replacementStore.state.getIdleCount(namespace, 'restart-scope'),
        ).resolves.toBe(0)
        await expect(
          replacementStore.events.read({ namespace }),
        ).resolves.toMatchObject({
          events: [expect.objectContaining({ name: 'crux.idle:restart-scope' })],
        })
        await expect.poll(async () =>
          await replacementStore.state.getWork(idle.workId, { namespace }),
        ).toBeNull()
        await expect.poll(async () =>
          await replacementStore.state.getWork(retained.workId, { namespace }),
        ).toBeNull()
        expect(executions).not.toContain('must-not-run')
      } finally {
        await replacement.stop()
      }
    })
  })

  async function withStores(
    run: (stores: {
      readonly firstStore: PostgresRuntimeStore
      readonly replacementStore: PostgresRuntimeStore
    }) => Promise<void>,
  ): Promise<void> {
    const schema = `crux_runtime_restart_${Date.now()}_${nextSchema++}`
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
