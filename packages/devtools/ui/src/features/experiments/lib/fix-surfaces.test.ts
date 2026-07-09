import { describe, expect, it } from 'vitest'
import type { QualityFailureArtifact } from '@/types'
import { failureForCell, fixSurfaceChips, groupFixSurfaceChips } from './fix-surfaces'

const failure = (over: Partial<QualityFailureArtifact> = {}): QualityFailureArtifact => ({
  caseId: 'c1',
  variant: 'candidate',
  trial: 0,
  phase: 'expect',
  scores: [],
  covers: ['prompt:support'],
  spanIds: [],
  suggestedFixSurfaces: ['prompt', 'retriever'],
  ...over,
})

describe('fixSurfaceChips', () => {
  it('maps each suggested surface to a labeled, toned chip', () => {
    const chips = fixSurfaceChips(failure())
    expect(chips.map((c) => c.surface)).toEqual(['prompt', 'retriever'])
    expect(chips.map((c) => c.label)).toEqual(['Prompt', 'Retriever'])
    expect(chips.every((c) => typeof c.tone === 'string')).toBe(true)
  })

  it('points every chip at the first covered definition for navigation', () => {
    const chips = fixSurfaceChips(failure({ covers: ['prompt:support', 'context:policy'] }))
    expect(chips.every((c) => c.target === 'prompt:support')).toBe(true)
  })

  it('leaves the target undefined when the eval covers no definition', () => {
    const chips = fixSurfaceChips(failure({ covers: [] }))
    expect(chips[0].target).toBeUndefined()
  })

  it('falls back to a raw label for an unknown surface value', () => {
    const chips = fixSurfaceChips(failure({ suggestedFixSurfaces: ['made-up' as never] }))
    expect(chips[0].label).toBe('made-up')
    expect(chips[0].tone).toBe('muted')
  })
})

describe('failureForCell', () => {
  const failures = [failure(), failure({ caseId: 'c2', variant: 'default', trial: 1 })]

  it('matches a failure artifact by case, variant, and trial', () => {
    const match = failureForCell(failures, { caseId: 'c2', variantName: 'default', trial: 1 })
    expect(match?.caseId).toBe('c2')
  })

  it('returns undefined when no artifact matches the cell', () => {
    expect(failureForCell(failures, { caseId: 'c1', variantName: 'default', trial: 0 })).toBeUndefined()
    expect(failureForCell(undefined, { caseId: 'c1', variantName: 'candidate', trial: 0 })).toBeUndefined()
  })
})

describe('groupFixSurfaceChips', () => {
  it('unions surfaces across a group, one chip per surface (first target wins)', () => {
    const failures = [
      failure({ variant: 'candidate', suggestedFixSurfaces: ['prompt', 'retriever'], covers: ['prompt:a'] }),
      failure({ variant: 'default', suggestedFixSurfaces: ['prompt', 'judge'], covers: ['prompt:b'] }),
    ]
    const chips = groupFixSurfaceChips(failures, [
      { caseId: 'c1', variantName: 'candidate', trial: 0 },
      { caseId: 'c1', variantName: 'default', trial: 0 },
    ])
    expect(chips.map((c) => c.surface)).toEqual(['prompt', 'retriever', 'judge'])
    expect(chips.find((c) => c.surface === 'prompt')?.target).toBe('prompt:a')
  })

  it('is empty when no cell in the group has a failure artifact', () => {
    expect(groupFixSurfaceChips([], [{ caseId: 'c1', variantName: 'x', trial: 0 }])).toEqual([])
  })
})
