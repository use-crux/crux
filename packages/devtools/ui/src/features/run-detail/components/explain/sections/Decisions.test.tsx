import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TurnDecision } from '@/types'
import { DecisionRow } from './Decisions'

describe('DecisionRow Safety provenance', () => {
  it('shows the semantic target, source badge, and safe retrieval id', () => {
    const decision: TurnDecision = {
      id: 'decision:safety:0:retrieval:model.input.text',
      phase: 'checks',
      kind: 'safety.guardrail',
      subject: { kind: 'guardrail', id: 'retrieval-policy', label: 'retrieval-policy' },
      outcome: 'rewrite',
      reason: {
        code: 'guardrail.redacted',
        text: 'Unsafe instructions removed.',
        source: 'artifact',
        evidenceLevel: 'declared',
      },
      safety: {
        target: { id: 'model.input.text', label: 'Model input · Text' },
        mode: 'enforce',
        changed: true,
        origin: {
          source: 'retrieval',
          kind: 'retrieval-context',
          retrieverId: 'docs',
        },
      },
    }

    const html = renderToStaticMarkup(<DecisionRow decision={decision} />)

    expect(html).toContain('Model input · Text')
    expect(html).toContain('Retrieval')
    expect(html).toContain('docs')
    expect(html).toContain('enforce · changed')
  })
})
