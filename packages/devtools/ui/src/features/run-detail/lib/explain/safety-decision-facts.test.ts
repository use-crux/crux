import { describe, expect, it } from 'vitest'
import type { TurnDecision } from '@/types'
import { safetyDecisionFacts } from './safety-decision-facts'

describe('safetyDecisionFacts', () => {
  it('renders a tool source badge and only its safe identifiers', () => {
    const facts = safetyDecisionFacts({
      safety: {
        target: { id: 'model.input.text', label: 'Model input · Text' },
        mode: 'enforce',
        changed: true,
        origin: {
          source: 'tool',
          kind: 'tool-result',
          toolName: 'search',
          toolCallId: 'call-1',
        },
      },
    } as TurnDecision)

    expect(facts).toEqual({
      target: 'Model input · Text',
      source: 'Tool',
      identifier: 'search · call-1',
      posture: 'enforce · changed',
    })
    expect(JSON.stringify(facts)).not.toMatch(/content|arguments|result/i)
  })

  it('falls back to unknown target and source strings without crashing', () => {
    const decision = {
      safety: {
        target: { id: 'future.model.input', label: '' },
        mode: 'report',
        changed: false,
        origin: { source: 'future-source', kind: 'future-kind' },
      },
    } as unknown as TurnDecision

    expect(safetyDecisionFacts(decision)).toEqual({
      target: 'future.model.input',
      source: 'future-source',
      posture: 'report',
    })
  })
})
