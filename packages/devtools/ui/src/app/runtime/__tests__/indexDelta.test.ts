import { describe, expect, it } from 'vitest'
import { applyIndexDelta, normalizeProjectIndexData, type IndexDeltaMessage } from '../indexDelta'

describe('index delta application', () => {
  it('updates one source file without replacing the full index cache', () => {
    const file = '/repo/src/writer.ts'
    const current = normalizeProjectIndexData({
      definitions: [
        { id: 'prompt:writer', kind: 'prompt', name: 'writer', fidelity: 'resolved', status: 'active', description: 'old', source: { file, line: 1 } },
        { id: 'prompt:other', kind: 'prompt', name: 'other', fidelity: 'resolved', status: 'active', source: { file: '/repo/src/other.ts', line: 1 } },
      ],
      diagnostics: [
        { id: 'diagnostic:writer:old', severity: 'info', code: 'index.old', message: 'Old', source: { file, line: 1 } },
        { id: 'diagnostic:other', severity: 'info', code: 'index.other', message: 'Other', source: { file: '/repo/src/other.ts', line: 1 } },
      ],
      sources: [
        { file, status: 'indexed', definitionIds: ['prompt:writer'], diagnostics: ['diagnostic:writer:old'] },
        { file: '/repo/src/other.ts', status: 'indexed', definitionIds: ['prompt:other'] },
      ],
    })
    const delta = {
      type: 'index:delta',
      generation: 2,
      file,
      definitions: {
        changed: [{ id: 'prompt:writer', kind: 'prompt', name: 'writer', fidelity: 'resolved', status: 'active', description: 'new', source: { file, line: 1 } }],
        removedIds: [],
      },
      diagnostics: [
        { id: 'diagnostic:writer:new', severity: 'warning', code: 'index.new', message: 'New', source: { file, line: 1 } },
      ],
      sourceRow: { file, status: 'indexed', definitionIds: ['prompt:writer'], diagnostics: ['diagnostic:writer:new'] },
    } satisfies IndexDeltaMessage

    const next = applyIndexDelta(current, delta)

    expect(next?.definitions.map((definition) => [definition.id, definition.description])).toEqual([
      ['prompt:writer', 'new'],
      ['prompt:other', undefined],
    ])
    expect(next?.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(['diagnostic:other', 'diagnostic:writer:new'])
    expect(next?.sources.find((source) => source.file === file)?.diagnostics).toEqual(['diagnostic:writer:new'])
  })
})
