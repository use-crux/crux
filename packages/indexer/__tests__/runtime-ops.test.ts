import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  transition,
  type FlowId,
  type RuntimeTargetId,
  type TaskId,
  type WorkId,
} from '@use-crux/core/runtime'
import { flow } from '@use-crux/core/flow'
import { postgres, type PostgresRuntimeStore } from '@use-crux/postgres/runtime'
import { runRuntimeOperation } from '../indexer/runtime-ops'
import {
  closeRuntimeOpsPools,
  dropPostgresSchemas,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './runtime-ops-test-database'

const roots: string[] = []
const schemas: string[] = []
let database: PostgresTestDatabase

const runtimeOpsReviewFlow = flow('runtime-ops-review', async (scope) => {
  await scope.step('new-label', () => 'ok')
  await scope.suspend('approval')
})
void runtimeOpsReviewFlow

describe('runtime operations', () => {
  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  })

  afterEach(async () => {
    await closeRuntimeOpsPools()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  afterAll(async () => {
    await closeRuntimeOpsPools()
    try {
      await dropPostgresSchemas(database, schemas)
    } finally {
      await database.close()
    }
  })

  it('runs setup/status/inspect/retry/cancel against node({ store: postgres() })', async () => {
    const schema = `crux_runtime_ops_${Date.now()}`
    schemas.push(schema)
    const root = await runtimeOpsFixtureRoot({ schema })

    await expect(runRuntimeOperation({ root, operation: 'setup-check' }))
      .resolves.toMatchObject({ operation: 'setup-check', ok: false })
    await expect(runRuntimeOperation({ root, operation: 'setup-apply' }))
      .resolves.toMatchObject({ operation: 'setup-apply', ok: true })
    await expect(runRuntimeOperation({ root, operation: 'setup-check' }))
      .resolves.toMatchObject({ operation: 'setup-check', ok: true })

    const seedStore = postgres({
      url: database.url,
      schema,
      poolOptions: { allowExitOnIdle: true },
    })
    try {
      await seedReplayDivergedWork(seedStore)
      await seedCancellableWork(seedStore)
    } finally {
      await seedStore.close()
    }

    const status = await runRuntimeOperation({ root, operation: 'status' })
    expect(status).toMatchObject({
      operation: 'status',
      ok: true,
      counts: expect.arrayContaining([
        expect.objectContaining({
          status: 'blocked',
          targetId: 'runtime-ops-review',
          count: 1,
        }),
        expect.objectContaining({
          status: 'pending',
          targetId: 'runtime-ops-cancel',
          count: 1,
        }),
      ]),
    })

    await expect(runRuntimeOperation({
      root,
      operation: 'inspect',
      workId: 'work_runtime_ops_replay',
    })).resolves.toMatchObject({
      operation: 'inspect',
      ok: true,
      work: {
        workId: 'work_runtime_ops_replay',
        status: 'blocked',
        lastError: { code: 'REPLAY_DIVERGED' },
      },
      flow: {
        flowId: 'flow_runtime_ops_replay',
        fingerprint: ['step:old-label'],
      },
    })

    const retry = await runRuntimeOperation({
      root,
      operation: 'retry',
      workId: 'work_runtime_ops_replay',
    })
    expect(retry).toMatchObject({
      operation: 'retry',
      ok: true,
      retried: true,
      work: {
        status: 'pending',
        attempt: 1,
        idempotencyKey: expect.stringMatching(/^retry:work_runtime_ops_replay:/),
      },
      dispatch: { delivered: 1, failed: 0 },
    })

    await expect(runRuntimeOperation({
      root,
      operation: 'inspect',
      workId: 'work_runtime_ops_replay',
    })).resolves.toMatchObject({
      operation: 'inspect',
      ok: true,
      work: {
        status: 'blocked',
        attempt: 1,
        lastError: { code: 'REPLAY_DIVERGED' },
      },
    })

    await expect(runRuntimeOperation({
      root,
      operation: 'cancel',
      workId: 'work_runtime_ops_cancel',
    })).resolves.toMatchObject({
      operation: 'cancel',
      ok: true,
      cancelled: true,
    })
  }, 30_000)
})

async function runtimeOpsFixtureRoot(options: { readonly schema: string }): Promise<string> {
  const root = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.tmp-runtime-ops-'))
  roots.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, '.crux/generated/runtime'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(
    join(root, 'crux.config.ts'),
    [
      "import { config } from '@use-crux/core'",
      "import { node } from '@use-crux/core/runtime'",
      "import { postgres } from '@use-crux/postgres/runtime'",
      "import { Pool } from 'pg'",
      '',
      "const globalPools = globalThis as typeof globalThis & { __cruxRuntimeOpsPools?: Pool[] }",
      'globalPools.__cruxRuntimeOpsPools ??= []',
      `const pool = new Pool({ connectionString: ${JSON.stringify(database.url)}, allowExitOnIdle: true })`,
      'globalPools.__cruxRuntimeOpsPools.push(pool)',
      '',
      'export default config({',
      `  runtime: node({ store: postgres({ pool, schema: ${JSON.stringify(options.schema)} }) }),`,
      '})',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'src/runtime-targets.ts'),
    [
      "import { flow } from '@use-crux/core/flow'",
      '',
      "export const reviewFlow = flow('runtime-ops-review', async (flow) => {",
      "  await flow.step('new-label', () => 'ok')",
      "  await flow.suspend('approval')",
      '})',
    ].join('\n'),
  )
  await writeFile(
    join(root, '.crux/generated/runtime/manifest.json'),
    `${JSON.stringify({
      version: 1,
      targets: [
        {
          name: 'runtime-ops-review',
          kind: 'flow',
          module: './src/runtime-targets.ts',
          export: 'reviewFlow',
        },
      ],
    }, null, 2)}\n`,
  )
  return root
}

async function seedReplayDivergedWork(store: PostgresRuntimeStore): Promise<void> {
  const now = new Date('2026-07-03T00:00:00.000Z')
  const work = await store.state.createWork({
    workId: 'work_runtime_ops_replay' as WorkId,
    namespace: 'local',
    work: { kind: 'flow.resume', flowId: 'flow_runtime_ops_replay' as FlowId },
    targetId: 'runtime-ops-review' as RuntimeTargetId,
    idempotencyKey: 'start:work_runtime_ops_replay',
    now,
  })
  await store.state.putSnapshot({
    flowId: 'flow_runtime_ops_replay' as FlowId,
    workId: 'work_runtime_ops_replay' as WorkId,
    targetId: 'runtime-ops-review' as RuntimeTargetId,
    namespace: 'local',
    status: 'suspended',
    input: {},
    completedSteps: {},
    fingerprint: ['step:old-label'],
    pendingSuspends: [],
    scheduledEffects: {},
    updatedAt: now,
  })
  await store.state.putWork(
    transition(work, {
      status: 'blocked',
      lastError: {
        code: 'REPLAY_DIVERGED',
        message: 'previous replay drift',
        at: now,
      },
    }),
  )
}

async function seedCancellableWork(store: PostgresRuntimeStore): Promise<void> {
  await store.state.createWork({
    workId: 'work_runtime_ops_cancel' as WorkId,
    namespace: 'local',
    work: {
      kind: 'task.run',
      taskId: 'task_runtime_ops_cancel' as TaskId,
      targetId: 'runtime-ops-cancel' as RuntimeTargetId,
      input: {},
    },
    targetId: 'runtime-ops-cancel' as RuntimeTargetId,
    idempotencyKey: 'task:work_runtime_ops_cancel',
    now: new Date('2026-07-03T00:00:00.000Z'),
  })
}
