import { afterEach, describe, expect, it } from 'vitest'
import { inMemoryRecordStore } from '../../src/storage'
import { workspace } from '../../src/workspace'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type { DefinitionRef } from '../../src/observability'

type Transport = ReturnType<typeof createInMemoryObservabilityTransport>

const ABSOLUTE_PATH = /(^|")(\/[^"]*|[A-Za-z]:[\\/])/

describe('workspace.operation spans emit an invoked-workspace definition ref', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('emits workspace:<safeId(id)> on the operation span, never an absolute path', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    // `workspace()` requires `id`, so every operation span is truthfully attributable.
    const ws = workspace({ id: 'research', namespace: 'thread:1', records: inMemoryRecordStore() })
    await ws.write('/workspace/top.md', 'top')
    await observe.flush()

    const opSpans = transport.records.filter(
      (record) => record.type === 'span:start' && record.primitive === 'workspace.operation',
    ) as Array<{ definitionRefs?: DefinitionRef[] }>
    expect(opSpans.length).toBeGreaterThanOrEqual(1)
    for (const span of opSpans) {
      expect(span.definitionRefs).toEqual([
        { id: 'workspace:research', kind: 'workspace', role: 'invoked-workspace' },
      ])
    }

    const refs = transport.records.flatMap(
      (record) => (record as { definitionRefs?: DefinitionRef[] }).definitionRefs ?? [],
    )
    for (const ref of refs) {
      expect(JSON.stringify(ref)).not.toMatch(ABSOLUTE_PATH)
    }
  })
})
