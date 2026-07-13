import { describe, expect, it } from 'vitest'
import type {
  FlowId,
  FlowSnapshot,
  RuntimeTargetId,
  WorkId,
} from '@use-crux/core/runtime'
import {
  createMemoryRuntimeData,
  scopedKey,
} from '../../src/runtime/adapters/memory/data'
import { createMemoryStatePort } from '../../src/runtime/adapters/memory/state'

describe('Runtime flow snapshot migration', () => {
  it('reads legacy memory scheduledEffects and writes scheduledWork only', async () => {
    const data = createMemoryRuntimeData()
    const state = createMemoryStatePort(data)
    const legacy = snapshotFixture('flow_legacy') as FlowSnapshot & {
      readonly scheduledEffects: {
        readonly 'defer:1': { readonly workId: WorkId }
      }
    }
    data.snapshots.set(scopedKey('tenant-a', legacy.flowId), legacy)

    await expect(
      state.getSnapshot(legacy.flowId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      scheduledWork: {
        'defer:1': { workId: 'work_child' },
      },
    })

    const next = {
      ...snapshotFixture('flow_new'),
      scheduledWork: {
        'defer:1': { workId: 'work_current' as WorkId },
      },
    } as FlowSnapshot
    await state.putSnapshot(next)

    const stored = data.snapshots.get(scopedKey('tenant-a', next.flowId)) as
      | (FlowSnapshot & { readonly scheduledEffects?: unknown })
      | undefined
    expect(stored?.scheduledWork).toEqual(next.scheduledWork)
    expect(stored).not.toHaveProperty('scheduledEffects')
  })
})

function snapshotFixture(flowId: string): Omit<
  FlowSnapshot,
  'scheduledWork'
> & {
  readonly scheduledEffects?: unknown
} {
  return {
    flowId: flowId as FlowId,
    workId: 'work_parent' as WorkId,
    targetId: 'review' as RuntimeTargetId,
    namespace: 'tenant-a',
    status: 'suspended',
    input: {},
    completedSteps: {},
    fingerprint: [],
    pendingSuspends: [],
    scheduledEffects: {
      'defer:1': { workId: 'work_child' as WorkId },
    },
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
  }
}
