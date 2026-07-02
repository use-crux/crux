import { expect, it } from 'vitest'
import type { FlowId, RuntimeTargetId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import { makeConformanceWorkItem } from './store-fixtures'
import type { RunStoreAdapterTestsOptions } from './store-types'

export function registerStoreRecordTests<TStore extends RuntimeStoreAdapter>(
  options: RunStoreAdapterTestsOptions<TStore>,
): void {
  it('invariant: durable events support cursor reads and duplicate idempotency', async () => {
    const store = await options.createStore()
    const payload = { documentId: 'doc_1', nested: { approved: true } }

    const first = await store.events.append({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload,
    })
    payload.nested.approved = false

    const duplicate = await store.events.append({
      namespace: 'tenant-a',
      name: 'document.changed',
      payload: { ignored: true },
      eventId: first.eventId,
    })
    const second = await store.events.append({
      namespace: 'tenant-a',
      name: 'document.archived',
      payload: { documentId: 'doc_1' },
    })
    await store.events.append({
      namespace: 'tenant-b',
      name: 'document.approved',
      payload: { documentId: 'doc_2' },
    })

    expect(duplicate).toEqual(first)
    await expect(store.events.read({ namespace: 'tenant-a' })).resolves.toEqual({
      events: [
        expect.objectContaining({
          eventId: first.eventId,
          name: 'document.approved',
          payload: { documentId: 'doc_1', nested: { approved: true } },
        }),
        expect.objectContaining({
          eventId: second.eventId,
          name: 'document.archived',
        }),
      ],
      cursor: second.eventId,
    })
    await expect(
      store.events.read({ namespace: 'tenant-a', after: first.eventId }),
    ).resolves.toEqual({
      events: [expect.objectContaining({ eventId: second.eventId })],
      cursor: second.eventId,
    })
  })

  it('invariant: state records are cloned and namespace isolated', async () => {
    const store = await options.createStore()
    const work = makeConformanceWorkItem()

    await store.state.putWork(work)
    const readWork = await store.state.getWork(work.workId, {
      namespace: 'tenant-a',
    })
    expect(readWork).toEqual(work)
    expect(Object.isFrozen(readWork)).toBe(true)
    await expect(
      store.state.getWork(work.workId, { namespace: 'tenant-b' }),
    ).resolves.toBeNull()

    await store.state.putSnapshot({
      flowId: 'flow_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'suspended',
      input: { documentId: 'doc_1' },
      completedSteps: { load: { ok: true } },
      fingerprint: ['step:load', 'suspend:approval'],
      pendingSuspends: [{ label: 'approval' }],
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    })
    const snapshot = await store.state.getSnapshot('flow_1' as FlowId, {
      namespace: 'tenant-a',
    })
    expect(snapshot?.completedSteps).toEqual({ load: { ok: true } })
    ;(
      snapshot as unknown as { completedSteps: { load: { ok: boolean } } }
    ).completedSteps.load.ok = false
    await expect(
      store.state.getSnapshot('flow_1' as FlowId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ completedSteps: { load: { ok: true } } })

    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'resume:work_1:event_1'),
    ).resolves.toBe(false)
    await store.state.putIdempotencyKey({
      namespace: 'tenant-a',
      key: 'resume:work_1:event_1',
      completedAt: new Date('2026-07-02T00:01:00.000Z'),
    })
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'resume:work_1:event_1'),
    ).resolves.toBe(true)
    await expect(
      store.state.hasIdempotencyKey('tenant-b', 'resume:work_1:event_1'),
    ).resolves.toBe(false)
  })
}
