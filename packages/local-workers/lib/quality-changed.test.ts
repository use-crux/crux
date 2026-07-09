import { describe, expect, it } from 'vitest'
import { selectChangedEvaluationsForFiles } from './quality-changed'
import type { CollectedEvaluation } from './quality-collect'
import type { EvaluationManifest } from '@use-crux/core/quality'

describe('selectChangedEvaluationsForFiles', () => {
  it('selects evaluations whose defining files changed', () => {
    const selected = selectChangedEvaluationsForFiles({
      changedFiles: ['evals/refunds.eval.ts'],
      collected: [
        changedEntry('support.refunds', 'evals/refunds.eval.ts'),
        changedEntry('support.shipping', 'evals/shipping.eval.ts'),
      ],
    })

    expect(selected).toEqual({ ids: ['support.refunds'] })
  })

  it('fails open when covered definition source files are not mapped', () => {
    const selected = selectChangedEvaluationsForFiles({
      changedFiles: ['src/prompts.ts'],
      collected: [changedEntry('support.refunds', 'evals/refunds.eval.ts', ['prompt:support.refunds'])],
    })

    expect(selected.ids).toEqual(['support.refunds'])
    expect(selected.failOpenReason).toContain('could not prove covered definition source files')
  })
})

function changedEntry(id: string, file: string, covers?: EvaluationManifest['covers']): CollectedEvaluation {
  return {
    id,
    explicitId: true,
    file,
    exportName: 'default',
    source: 'file',
    manifest: {
      schemaVersion: 1,
      id,
      explicitId: true,
      file,
      exportName: 'default',
      source: 'file',
      tags: [],
      ...(covers !== undefined ? { covers } : {}),
      task: { kind: 'fn', capabilities: [] },
      cases: [],
      datasets: [],
      hasEvaluationExpect: false,
      hasEvaluationAfterScores: false,
      scorers: [],
      variants: [],
      trials: 1,
      flags: { only: false, skip: false },
    },
    handle: { _tag: 'CruxQualityEvaluationHandle' },
  }
}
