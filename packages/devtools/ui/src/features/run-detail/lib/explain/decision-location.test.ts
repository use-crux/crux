import { describe, expect, it } from 'vitest'
import { decisionLocationLabel } from './decision-location'
import { guardrailReportRows } from '../guardrail-report-facts'

function presentationRows(
  rows: ReturnType<typeof guardrailReportRows>,
): [string, string, string?][] {
  return rows.map(([label, value, color]) =>
    color === undefined ? [label, value] : [label, value, color],
  )
}

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
        origin: {
          kind: 'tool-result',
          toolName: 'search',
          toolCallId: 'call-1',
          partIndex: 0,
        },
        partType: 'image',
      }),
    ).toBe('search · call-1 · part 0 · image')
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

  it('renders bounded stream coordinates without inventing part indexes', () => {
    expect(
      decisionLocationLabel({
        origin: {
          kind: 'operation',
          operation: 'streamImage',
          phase: 'preview',
          field: 'images',
          outputIndex: 2,
          sequence: 4,
        },
        partType: 'image',
      }),
    ).toBe('streamImage · preview · images · output 2 · sequence 4 · image')
    expect(
      decisionLocationLabel({
        origin: {
          kind: 'operation',
          operation: 'streamImage',
          phase: 'final',
          field: 'images',
          outputIndex: 1,
        },
        partType: 'image',
      }),
    ).toBe('streamImage · final · images · output 1 · image')
    expect(
      decisionLocationLabel({
        origin: {
          kind: 'operation',
          operation: 'streamSpeech',
          phase: 'final',
          field: 'audio',
          outputIndex: 0,
        },
        partType: 'audio',
      }),
    ).toBe('streamSpeech · final · audio · output 0 · audio')
  })

  it('renders flattened operation reports and strip escalation', () => {
    expect(
      presentationRows(
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
      ),
    ).toEqual(
      expect.arrayContaining([
        ['origin', 'generateImage · output · images · part 1 · image'],
        ['escalation', 'strip to block', 'var(--devtools-danger)'],
      ]),
    )
  })

  it('renders semantic target and tool provenance without content', () => {
    const rows = guardrailReportRows({
      kind: 'guardrail.report',
      phase: 'input',
      action: 'rewrite',
      mode: 'report',
      target: { id: 'model.input.text', label: 'Model input · Text' },
      origin: {
        source: 'tool',
        kind: 'tool-result',
        toolName: 'search',
        toolCallId: 'call-1',
      },
    })

    expect(presentationRows(rows)).toEqual(
      expect.arrayContaining([
        ['target', 'Model input · Text'],
        ['source', 'Tool · search · call-1'],
        ['mode', 'report'],
      ]),
    )
    expect(JSON.stringify(rows)).not.toMatch(/content|arguments|result/i)
  })
})
