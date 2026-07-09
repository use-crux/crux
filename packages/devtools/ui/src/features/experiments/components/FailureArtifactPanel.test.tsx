import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QualityFailureArtifact } from '@/types'
import { FailureArtifactPanel } from './FailureArtifactPanel'

const failure: QualityFailureArtifact = {
  caseId: 'c1',
  variant: 'candidate',
  trial: 0,
  phase: 'expect',
  scores: [],
  covers: ['prompt:support'],
  spanIds: [],
  cassetteId: 'evals.bakeoff',
  datasetProvenance: { path: 'datasets/refunds.jsonl', contentFingerprint: 'sha256:abcdef012345' },
  suggestedFixSurfaces: ['prompt', 'retriever'],
}

describe('FailureArtifactPanel', () => {
  it('renders fix-surface chips, dataset provenance, and cassette id', () => {
    const html = renderToStaticMarkup(<FailureArtifactPanel failure={failure} onNavigate={() => {}} />)
    expect(html).toContain('Prompt')
    expect(html).toContain('Retriever')
    expect(html).toContain('datasets/refunds.jsonl @ sha256:abc…')
    expect(html).toContain('evals.bakeoff')
  })

  it('renders nothing when the artifact carries no surfaces, provenance, or cassette', () => {
    const bare: QualityFailureArtifact = { ...failure, suggestedFixSurfaces: [], datasetProvenance: undefined, cassetteId: undefined }
    expect(renderToStaticMarkup(<FailureArtifactPanel failure={bare} onNavigate={() => {}} />)).toBe('')
  })
})
