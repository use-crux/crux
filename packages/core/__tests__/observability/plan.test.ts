import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { plan, updatePlan } from '../../src/plan/plans'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'
import { inMemoryRecordStore } from '../../src/storage'

describe('canonical plan observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

    it('records plan mutations with full plan artifact data for devtools read models', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({ records: inMemoryRecordStore() })

    const created = await plan({
      title: 'Fact check plan',
      content: 'Review claims and add verification markers.',
      metadata: { status: 'draft' },
    })
    await updatePlan(created.id, {
      content: 'Review claims, add verification markers, and cite launch date.',
      metadata: { status: 'draft', draftId: 'draft_1' },
    })
    await observe.flush()

    const spans = transport.records.filter((record) => record.type === 'span:start')
    expect(spans).toContainEqual(
      expect.objectContaining({
        primitive: 'plan.operation',
        family: 'plan',
        attributes: expect.objectContaining({ operation: 'create' }),
      }),
    )
    expect(spans).toContainEqual(
      expect.objectContaining({
        primitive: 'plan.operation',
        family: 'plan',
        attributes: expect.objectContaining({ operation: 'update', planId: created.id }),
      }),
    )

    const artifacts = transport.records.filter(
      (record) => record.type === 'artifact' && record.attributes?.primitive === 'plan.operation',
    )
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        preview: expect.objectContaining({
          operation: 'create',
          planId: created.id,
          title: 'Fact check plan',
          version: 1,
          content: 'Review claims and add verification markers.',
          metadata: { status: 'draft' },
        }),
      }),
    )
    expect(artifacts).toContainEqual(
      expect.objectContaining({
        preview: expect.objectContaining({
          operation: 'update',
          planId: created.id,
          version: 2,
          content: 'Review claims, add verification markers, and cite launch date.',
          metadata: { status: 'draft', draftId: 'draft_1' },
        }),
      }),
    )
  })
})
