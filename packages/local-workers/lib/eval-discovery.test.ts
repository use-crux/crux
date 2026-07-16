import { describe, expect, it } from 'vitest'
import { evaluate } from '@use-crux/core/eval'
import * as core from '@use-crux/core/eval/internal/runner'
import { collectEvalModules, deriveEvalId, selectEvals } from './eval-discovery'

const task = async (input: { question: string }) => input.question

function evalValue(id?: string) {
  return evaluate({ ...(id === undefined ? {} : { id }), task, cases: [{ id: 'one', input: { question: '?' } }] })
}

describe('Eval discovery', () => {
  it('derives the simple id beneath evals and lets an explicit id win', async () => {
    const result = await collectEvalModules({
      projectRoot: '/repo',
      core,
      modules: [
        { relativeFile: 'evals/support.eval.ts', exports: { default: evalValue() } },
        { relativeFile: 'evals/nested/billing.eval.ts', exports: { default: evalValue('billing') } },
      ],
    })

    expect(result.errors).toEqual([])
    expect(result.evals.map(({ id, sourceKey, sidecarFile }) => ({ id, sourceKey, sidecarFile }))).toEqual([
      {
        id: 'billing',
        sourceKey: { relativeFile: 'evals/nested/billing.eval.ts', export: 'default' },
        sidecarFile: 'evals/nested/billing.cases.jsonl',
      },
      {
        id: 'support',
        sourceKey: { relativeFile: 'evals/support.eval.ts', export: 'default' },
        sidecarFile: 'evals/support.cases.jsonl',
      },
    ])
  })

  it('rejects named or multiple Eval exports with their names and a split-file remedy', async () => {
    const result = await collectEvalModules({
      projectRoot: '/repo',
      core,
      modules: [
        {
          relativeFile: 'evals/mixed.eval.ts',
          exports: { default: evalValue(), alternate: evalValue('alternate') },
        },
        { relativeFile: 'evals/named.eval.ts', exports: { named: evalValue() } },
      ],
    })

    expect(result.evals).toEqual([])
    expect(result.errors).toEqual([
      expect.objectContaining({ file: 'evals/mixed.eval.ts', exports: ['default', 'alternate'] }),
      expect.objectContaining({ file: 'evals/named.eval.ts', exports: ['named'] }),
    ])
    expect(result.errors[0]?.message).toMatch(/one default Eval.*split.*file/i)
    expect(result.errors[1]?.message).toMatch(/default export/i)
  })

  it('resolves exact ids before paths and reports ambiguous selectors with copyable ids', () => {
    const entries = [
      { id: 'support', sourceKey: { relativeFile: 'evals/support.eval.ts', export: 'default' as const } },
      { id: 'support-refunds', sourceKey: { relativeFile: 'evals/support/refunds.eval.ts', export: 'default' as const } },
    ]

    expect(selectEvals(entries, ['support'])).toEqual({ matches: [entries[0]], errors: [] })
    expect(selectEvals(entries, ['evals/support'])).toMatchObject({ matches: entries, errors: [] })
    expect(selectEvals(entries, ['support*'])).toMatchObject({ matches: entries, errors: [] })
    expect(selectEvals(entries, ['missing']).errors[0]?.message).toMatch(/No Eval matches 'missing'/)

    const linked = entries.map((entry) => ({ ...entry, links: ['prompt:support'] }))
    const ambiguity = selectEvals(linked, ['prompt:support'])
    expect(ambiguity.matches).toEqual([])
    expect(ambiguity.errors[0]?.message).toMatch(/ambiguous.*crux eval support.*crux eval support-refunds/i)
  })

  it('normalizes derived ids consistently across separators', () => {
    expect(deriveEvalId('evals/support/refunds.eval.ts')).toBe('support.refunds')
    expect(deriveEvalId('evals\\support\\refunds.eval.ts')).toBe('support.refunds')
  })
})
