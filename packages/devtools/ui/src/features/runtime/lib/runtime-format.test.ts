import { describe, expect, it } from 'vitest'
import { filterRuntimeWork } from './runtime-format'
import type { RuntimeWorkRow } from '../types'

describe('runtime view filtering', () => {
  const rows: readonly RuntimeWorkRow[] = [
    runtimeWork({ workId: 'work_a', status: 'blocked', namespace: 'local', targetId: 'review' }),
    runtimeWork({ workId: 'work_b', status: 'pending', namespace: 'prod', targetId: 'embed' }),
    runtimeWork({ workId: 'work_c', status: 'dead-letter', namespace: 'local', targetId: 'embed' }),
  ]

  it('filters work by status, namespace, and target', () => {
    expect(
      filterRuntimeWork(rows, {
        status: 'dead-letter',
        namespace: 'local',
        targetId: 'embed',
      }).map((row) => row.workId),
    ).toEqual(['work_c'])
  })
})

function runtimeWork(row: Pick<RuntimeWorkRow, 'workId' | 'status' | 'namespace' | 'targetId'>): RuntimeWorkRow {
  return {
    ...row,
    work: { kind: 'task.run' },
    attempt: 1,
    maxAttempts: 8,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  }
}
