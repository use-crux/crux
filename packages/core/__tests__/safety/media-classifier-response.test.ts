import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import type { GenerateObjectFn } from '../../src/compaction'
import {
  guardrail,
  type MediaPartSubject,
  type SafetyRunContext,
} from '../../src/safety'

const PRIVATE_DESCRIPTION = 'Private authored description token.'
const PRIVATE_SOURCE = 'https://private.example/sensitive-document.pdf'
const PRIVATE_FILENAME = 'sensitive-document.pdf'

function inputFile(): MediaPartSubject {
  return {
    part: {
      type: 'file',
      source: PRIVATE_SOURCE,
      mediaType: 'application/pdf',
      filename: PRIVATE_FILENAME,
    },
    origin: { kind: 'message', messageIndex: 0, partIndex: 0 },
  }
}

function runContext(): SafetyRunContext {
  return {
    policy: { id: 'media-policy', mode: 'enforce' },
    boundary: { id: 'model.input.media', kind: 'model.input.media' },
    prompt: {},
    model: {},
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: { add() {} },
  }
}

/**
 * Deliberately violate the injected generator's generic contract so the test
 * can prove Core validates an untrusted structured response a second time.
 */
function returning(object: unknown): GenerateObjectFn {
  return (async () => ({ object })) as GenerateObjectFn
}

function classifierResponse(object: unknown) {
  return guardrail.mediaClassifier({
    generate: returning(object),
    model: 'classifier-model',
    categories: [
      { id: 'unsafe', description: PRIVATE_DESCRIPTION },
      { id: 'fraud', description: 'Fraud criterion.' },
    ],
    threshold: 0.8,
  })
}

describe('media classifier response validation', () => {
  it('accepts exactly one finite normalized score per category', async () => {
    await expect(
      classifierResponse({ scores: { unsafe: 0, fraud: 1 } })(
        inputFile(),
        runContext(),
      ),
    ).resolves.toEqual({
      action: 'block',
      reason:
        'Media classifier matched fraud (1.00 >= 0.80).',
    })
  })

  it.each([
    ['missing score', { scores: { unsafe: 0.1 } }],
    ['extra score', { scores: { unsafe: 0.1, fraud: 0.2, other: 0.3 } }],
    ['string score', { scores: { unsafe: '0.1', fraud: 0.2 } }],
    ['NaN score', { scores: { unsafe: Number.NaN, fraud: 0.2 } }],
    ['infinite score', { scores: { unsafe: Infinity, fraud: 0.2 } }],
    ['negative score', { scores: { unsafe: -0.1, fraud: 0.2 } }],
    ['score above one', { scores: { unsafe: 1.1, fraud: 0.2 } }],
    ['missing envelope', {}],
    ['null score object', { scores: null }],
    [
      'extra envelope field',
      { scores: { unsafe: 0.1, fraud: 0.2 }, explanation: 'not accepted' },
    ],
    [
      'inherited score',
      { scores: Object.assign(Object.create({ unsafe: 0.1 }), { fraud: 0.2 }) },
    ],
    [
      'inherited extra key',
      {
        scores: Object.assign(
          Object.create({ inherited: 0.3 }),
          { unsafe: 0.1, fraud: 0.2 },
        ),
      },
    ],
    ...['__proto__', 'constructor', 'prototype'].map((key) => [
      `hostile ${key} score`,
      {
        scores: Object.fromEntries([
          ['unsafe', 0.1],
          ['fraud', 0.2],
          [key, 0.3],
        ]),
      },
    ]),
  ])('rejects %s without leaking private inputs', async (_name, object) => {
    const thrown = await classifierResponse(object)(
      inputFile(),
      runContext(),
    ).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(ZodError)
    const issues = JSON.stringify((thrown as ZodError).issues)
    expect(issues).not.toContain(PRIVATE_DESCRIPTION)
    expect(issues).not.toContain(PRIVATE_SOURCE)
    expect(issues).not.toContain(PRIVATE_FILENAME)
  })
})
