import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QualityFailureArtifact } from '@/types'
import { fixSurfaceChips } from '../lib/fix-surfaces'
import { FixSurfaceChipsView } from './FixSurfaceChips'

const fixtureFailure: QualityFailureArtifact = {
  caseId: 'c1',
  variant: 'candidate',
  trial: 0,
  phase: 'expect',
  scores: [],
  covers: ['prompt:support'],
  spanIds: [],
  suggestedFixSurfaces: ['prompt', 'retriever'],
}

describe('FixSurfaceChipsView', () => {
  it('renders one labeled chip per suggested fix surface from a fixture record', () => {
    const html = renderToStaticMarkup(
      <FixSurfaceChipsView chips={fixSurfaceChips(fixtureFailure)} onNavigate={() => {}} />,
    )
    expect(html).toContain('Prompt')
    expect(html).toContain('Retriever')
    // covered → clickable (chips advertise the navigation cursor)
    expect(html).toContain('cursor:pointer')
  })

  it('renders nothing when there are no fix surfaces', () => {
    expect(renderToStaticMarkup(<FixSurfaceChipsView chips={[]} onNavigate={() => {}} />)).toBe('')
  })
})
