import { expect } from 'vitest'
import {
  createRuntimeWorker,
  node,
  type RuntimeProgram,
  type RuntimeTargetId,
  type RuntimeWorker,
  type TaskId,
} from '@use-crux/core/runtime'
import type { PostgresRuntimeStore } from '../src/runtime'

export function startWorker(
  store: PostgresRuntimeStore,
  namespace: string,
  program: RuntimeProgram,
  retention?: { readonly terminalWork: 0; readonly sweepLimit: number },
): RuntimeWorker<PostgresRuntimeStore> {
  return createRuntimeWorker({
    runtime: node({
      store,
      namespace,
      autoStartMaintenance: false,
      ...(retention ? { retention } : {}),
    }),
    program,
    pollIntervalMs: 5,
  })
}

export async function startSettledWorker(
  store: PostgresRuntimeStore,
  namespace: string,
  program: RuntimeProgram,
): Promise<RuntimeWorker> {
  let ticks = 0
  const claimPending = store.outbox.claimPending.bind(store.outbox)
  const worker = createRuntimeWorker({
    runtime: node({
      store: {
        ...store,
        outbox: {
          ...store.outbox,
          async claimPending(options: Parameters<typeof claimPending>[0]) {
            ticks += 1
            return await claimPending(options)
          },
        },
      },
      namespace,
      autoStartMaintenance: false,
    }),
    program,
    pollIntervalMs: 60_000,
  })
  await expect.poll(() => ticks).toBe(1)
  return worker
}

export function taskWork(
  taskId: string,
  targetId: RuntimeTargetId,
  category: string,
) {
  return {
    kind: 'task.run' as const,
    taskId: taskId as TaskId,
    targetId,
    input: { category },
  }
}
