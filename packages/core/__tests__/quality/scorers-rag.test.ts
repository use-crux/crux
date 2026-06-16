import { describe, expect, it } from 'vitest'
import { scorers } from '../../quality/scorers'
import { invokeScorer, type ScorerRunContext } from '../../quality/internal/scorer-runtime'
import { emptyCellSignals, type CellSignals } from '../../quality/internal/signals'
import type { EngineSetup } from '../../quality/internal/engine'

/** Stub adapter generate returning a fixed judge verdict, recording prompts. */
function judgeStub(object: Record<string, unknown>) {
  const calls: Array<{ system?: string; user?: string }> = []
  const generate = async (prompt: unknown, _opts: unknown) => {
    const record = prompt as { config: { system?: unknown; prompt?: unknown } }
    calls.push({
      system: typeof record.config.system === 'string' ? record.config.system : undefined,
      user: typeof record.config.prompt === 'string' ? record.config.prompt : undefined,
    })
    return { object }
  }
  return { generate: generate as EngineSetup['generate'], calls }
}

function signalsWithHits(...previews: string[]): CellSignals {
  return {
    ...emptyCellSignals(),
    captured: new Set(['retrieval']),
    retrievalHits: previews.map((preview, index) => ({ rank: index + 1, sourceId: `s${index}`, preview })),
  }
}

function ragContext(stub: ReturnType<typeof judgeStub>, signals?: CellSignals): ScorerRunContext {
  return { generate: stub.generate, judgeModel: 'judge-m', ...(signals !== undefined ? { signals } : {}) }
}

describe('scorers.rag.faithfulness', () => {
  it('judges the answer against retrieved context from the cell signals, rationale in metadata', async () => {
    const stub = judgeStub({ reasoning: 'every claim is supported', score: 1 })
    const score = await invokeScorer(
      scorers.rag.faithfulness(),
      { input: { query: 'when do refunds land?' }, output: 'Refunds land in 5 days.', expected: undefined },
      ragContext(stub, signalsWithHits('Refund policy: refunds settle within 5 business days.')),
    )

    expect(score).toMatchObject({ name: 'faithfulness', score: 1 })
    expect(score.metadata?.rationale).toBe('every claim is supported')
    expect(stub.calls[0]!.system).toContain('Refund policy: refunds settle within 5 business days.')
    expect(stub.calls[0]!.user).toContain('Refunds land in 5 days.')
  })

  it('skips with score null when no retrieved context is available', async () => {
    const stub = judgeStub({ reasoning: 'r', score: 1 })
    const score = await invokeScorer(
      scorers.rag.faithfulness(),
      { input: { query: 'q' }, output: 'answer', expected: undefined },
      ragContext(stub),
    )
    expect(score.score).toBeNull()
    expect(score.metadata?.reason).toMatch(/no retrieved context/i)
    expect(stub.calls).toHaveLength(0)
  })

  it('falls back to a `context` field on the case input', async () => {
    const stub = judgeStub({ reasoning: 'r', score: 0.5 })
    const score = await invokeScorer(
      scorers.rag.faithfulness(),
      {
        input: { query: 'q', context: ['chunk one', 'chunk two'] },
        output: 'answer',
        expected: undefined,
      },
      ragContext(stub),
    )
    expect(score.score).toBe(0.5)
    expect(stub.calls[0]!.system).toContain('chunk one')
    expect(stub.calls[0]!.system).toContain('chunk two')
  })
})

describe('scorers.rag.answerRelevancy / contextPrecision / contextRecall', () => {
  it('answerRelevancy needs no context — question and answer reach the judge', async () => {
    const stub = judgeStub({ reasoning: 'on point', score: 0.8 })
    const score = await invokeScorer(
      scorers.rag.answerRelevancy(),
      { input: { query: 'when do refunds land?' }, output: 'in five days', expected: undefined },
      ragContext(stub),
    )
    expect(score).toMatchObject({ name: 'answerRelevancy', score: 0.8 })
    expect(stub.calls[0]!.user).toContain('when do refunds land?')
    expect(stub.calls[0]!.user).toContain('in five days')
  })

  it('contextPrecision judges the retrieved chunks against the question', async () => {
    const stub = judgeStub({ reasoning: 'mostly relevant', score: 0.6 })
    const score = await invokeScorer(
      scorers.rag.contextPrecision(),
      { input: { query: 'refund timing' }, output: 'answer', expected: undefined },
      ragContext(stub, signalsWithHits('refund chunk', 'shipping chunk')),
    )
    expect(score).toMatchObject({ name: 'contextPrecision', score: 0.6 })
    expect(stub.calls[0]!.user).toContain('refund chunk')
  })

  it('contextRecall needs an expected reference and skips honestly without one', async () => {
    const stub = judgeStub({ reasoning: 'covers it', score: 1 })
    const withReference = await invokeScorer(
      scorers.rag.contextRecall(),
      { input: { query: 'q' }, output: 'a', expected: 'refunds settle in 5 days' },
      ragContext(stub, signalsWithHits('refund chunk')),
    )
    expect(withReference.score).toBe(1)
    expect(stub.calls[0]!.user).toContain('refunds settle in 5 days')

    const withoutReference = await invokeScorer(
      scorers.rag.contextRecall(),
      { input: { query: 'q' }, output: 'a', expected: undefined },
      ragContext(stub, signalsWithHits('refund chunk')),
    )
    expect(withoutReference.score).toBeNull()
    expect(withoutReference.metadata?.reason).toMatch(/expected/i)
  })

  it('honors a name override and the judge model resolution chain', async () => {
    const stub = judgeStub({ reasoning: 'r', score: 1 })
    const score = await invokeScorer(
      scorers.rag.faithfulness({ name: 'grounded' }),
      { input: { query: 'q' }, output: 'a', expected: undefined },
      ragContext(stub, signalsWithHits('chunk')),
    )
    expect(score.name).toBe('grounded')
  })
})
