import { describe, expect, it } from 'vitest'
import { mergeSemanticAnalyzerResults } from '../indexer/semantic/runner'

describe('mergeSemanticAnalyzerResults', () => {
  it('preserves same-id source refs from different source declarations', () => {
    const merged = mergeSemanticAnalyzerResults([
      {
        sourceRefs: [
          sourceRefFact('/repo/src/retrieval.ts'),
          sourceRefFact('/repo/src/citations.ts'),
          sourceRefFact('/repo/src/retrieval.ts'),
        ],
      },
    ])

    expect(merged.sourceRefs).toHaveLength(2)
    expect(merged.sourceRefs.map((fact) => fact.ref.source.file)).toEqual([
      '/repo/src/retrieval.ts',
      '/repo/src/citations.ts',
    ])
  })
})

function sourceRefFact(file: string) {
  return {
    definitionId: 'context:anonymous',
    ref: {
      id: 'context:anonymous:source:system:system:rendered',
      role: 'system' as const,
      property: 'system',
      symbol: 'rendered',
      source: { file, line: 1, column: 1 },
      fidelity: 'resolved' as const,
    },
  }
}
