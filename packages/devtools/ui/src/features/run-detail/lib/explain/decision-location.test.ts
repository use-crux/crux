import { describe, expect, it } from 'vitest'
import { decisionLocationLabel } from './decision-location'
import { guardrailReportRows } from '../guardrail-report-facts'

describe('decisionLocationLabel', () => {
  it('renders every safe media origin without payload evidence', () => {
    expect(
      decisionLocationLabel({
        origin: { kind: 'message', messageIndex: 2, partIndex: 1 },
        partType: 'image',
      }),
    ).toBe('message 2 · part 1 · image')
    expect(
      decisionLocationLabel({
        origin: { kind: 'step', stepIndex: 3, partIndex: 2 },
        partType: 'file',
      }),
    ).toBe('step 3 · part 2 · file')
    expect(
      decisionLocationLabel({
        origin: {
          kind: 'operation',
          operation: 'generateSpeech',
          phase: 'output',
          field: 'audio',
          partIndex: 0,
        },
        partType: 'audio',
      }),
    ).toBe('generateSpeech · output · audio · part 0 · audio')
  })

  it('renders flattened operation reports and strip escalation', () => {
    expect(
      guardrailReportRows({
        kind: 'guardrail.report',
        phase: 'output',
        action: 'strip',
        originKind: 'operation',
        operation: 'generateImage',
        operationPhase: 'output',
        field: 'images',
        partIndex: 1,
        mediaPartType: 'image',
        escalatedToBlock: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        ['origin', 'generateImage · output · images · part 1 · image'],
        ['escalation', 'strip to block', 'var(--qw-danger)'],
      ]),
    )
  })
})
