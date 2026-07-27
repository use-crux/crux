import { describe, expect, it } from 'vitest'
import type { GenerateObjectFn } from '../../src/compaction'
import {
  guardrail,
  MEDIA_CLASSIFIER_PROMPT_VERSION,
  type SafetyFinding,
  type SafetyRunContext,
} from '../../src/safety'

function runContext(findings: SafetyFinding[]): SafetyRunContext {
  return {
    policy: { id: 'media-policy', mode: 'enforce' },
    boundary: { id: 'model.input.media', kind: 'model.input.media' },
    prompt: {},
    model: {},
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: { add: (finding) => findings.push(finding) },
  }
}

const image = {
  part: { type: 'image', source: new Uint8Array([1]) },
  origin: { kind: 'message', messageIndex: 0, partIndex: 0 },
} as const

function returningScores(scores: Readonly<Record<string, number>>): GenerateObjectFn {
  return async (options) => ({
    object: options.schema.parse({ scores }),
  })
}

describe('media classifier evaluation', () => {
  it('uses overrides and preserves authored order in findings and reason', async () => {
    const findings: SafetyFinding[] = []
    const run = guardrail.mediaClassifier({
      generate: returningScores({
        'sexual-content': 0.95,
        'graphic-violence': 0.91,
        fraud: 0.875,
      }),
      model: 'classifier-model',
      categories: [
        { id: 'sexual-content', description: 'Sexual content.' },
        { id: 'graphic-violence', description: 'Graphic violence.' },
        { id: 'fraud', description: 'Fraud.' },
      ],
      threshold: 0.8,
      thresholds: {
        'graphic-violence': 0.9,
        fraud: 0.875,
      },
      action: 'warn',
    })

    await expect(run(image, runContext(findings))).resolves.toEqual({
      action: 'warn',
      reason:
        'Media classifier matched sexual-content (0.95 >= 0.80), graphic-violence (0.91 >= 0.90), fraud (0.875 >= 0.875).',
    })
    expect(findings).toEqual([
      {
        type: 'media_classifier_match',
        category: 'sexual-content',
        score: 0.95,
        threshold: 0.8,
      },
      {
        type: 'media_classifier_match',
        category: 'graphic-violence',
        score: 0.91,
        threshold: 0.9,
      },
      {
        type: 'media_classifier_match',
        category: 'fraud',
        score: 0.875,
        threshold: 0.875,
      },
    ])
  })

  it.each([
    [undefined, 'block'],
    ['warn', 'warn'],
    ['block', 'block'],
    ['strip', 'strip'],
  ] as const)(
    'returns the %s configured match action as %s',
    async (action, expectedAction) => {
      const run = guardrail.mediaClassifier({
        generate: returningScores({ unsafe: 1 }),
        model: 'classifier-model',
        categories: [{ id: 'unsafe', description: 'Unsafe content.' }],
        threshold: 1,
        ...(action === undefined ? {} : { action }),
      })

      await expect(run(image, runContext([]))).resolves.toEqual({
        action: expectedAction,
        reason: 'Media classifier matched unsafe (1.00 >= 1.00).',
      })
    },
  )

  it('allows when no score reaches its effective threshold', async () => {
    const findings: SafetyFinding[] = []
    const run = guardrail.mediaClassifier({
      generate: returningScores({ unsafe: 0.799, fraud: 0.89 }),
      model: 'classifier-model',
      categories: [
        { id: 'unsafe', description: 'Unsafe content.' },
        { id: 'fraud', description: 'Fraud.' },
      ],
      threshold: 0.8,
      thresholds: { fraud: 0.9 },
    })

    await expect(run(image, runContext(findings))).resolves.toEqual({
      action: 'allow',
    })
    expect(findings).toEqual([])
  })

  it('preserves exponent notation while padding ordinary decimals', async () => {
    const run = guardrail.mediaClassifier({
      generate: returningScores({ tiny: 1e-7, ordinary: 0.9 }),
      model: 'classifier-model',
      categories: [
        { id: 'tiny', description: 'Tiny confidence.' },
        { id: 'ordinary', description: 'Ordinary confidence.' },
      ],
      threshold: 1e-8,
      thresholds: { ordinary: 0 },
    })

    await expect(run(image, runContext([]))).resolves.toEqual({
      action: 'block',
      reason:
        'Media classifier matched tiny (1e-7 >= 1e-8), ordinary (0.90 >= 0.00).',
    })
  })

  it('freezes normalized privacy-safe metadata with prompt identity', () => {
    const generate = returningScores({ unsafe: 0 })
    const model = { private: 'opaque-model' }
    const run = guardrail.mediaClassifier({
      generate,
      model,
      categories: [
        { id: 'unsafe', description: 'Private authored description.' },
      ],
      threshold: 0.8,
      thresholds: { unsafe: 0.9 },
    })

    expect(run.strategy).toEqual({
      kind: 'guardrail.mediaClassifier',
      config: {
        categoryIds: ['unsafe'],
        threshold: 0.8,
        thresholds: { unsafe: 0.9 },
        action: 'block',
        modalities: ['image', 'audio', 'video', 'file'],
        unsupported: 'throw',
        promptVersion: MEDIA_CLASSIFIER_PROMPT_VERSION,
      },
    })
    expect(JSON.stringify(run.strategy)).not.toContain('Private authored')
    expect(JSON.stringify(run.strategy)).not.toContain('opaque-model')
    expect([
      run.strategy,
      run.strategy?.config,
      run.strategy?.config.categoryIds,
      run.strategy?.config.thresholds,
      run.strategy?.config.modalities,
    ].every(Object.isFrozen)).toBe(true)
  })
})
