import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CruxUnsupportedStructuredOutputError } from '../../src/adapter/structured-output'
import type { GenerateObjectFn } from '../../src/generation/support-types'
import { createUnsupportedCapabilityError } from '../../src/content'
import {
  guardrail,
  type MediaClassifierUnsupportedAction,
  type MediaPartSubject,
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

function subject(type: 'image' | 'file'): MediaPartSubject {
  return {
    part:
      type === 'image'
        ? { type, source: new Uint8Array([1, 2, 3]) }
        : {
            type,
            source: 'https://private.example/sensitive.pdf',
            filename: 'sensitive.pdf',
          },
    origin: { kind: 'message', messageIndex: 0, partIndex: 0 },
  }
}

function throwing(error: unknown): GenerateObjectFn {
  return async () => {
    throw error
  }
}

function classifier(
  generate: GenerateObjectFn,
  unsupported?: MediaClassifierUnsupportedAction,
) {
  return guardrail.mediaClassifier({
    generate,
    model: 'classifier-model',
    categories: [
      { id: 'unsafe', description: 'Private authored description.' },
    ],
    threshold: 0.8,
    ...(unsupported === undefined ? {} : { unsupported }),
  })
}

describe('media classifier errors', () => {
  it('allows an excluded modality without a call or finding', async () => {
    let calls = 0
    const generate: GenerateObjectFn = async (options) => {
      calls += 1
      return { object: options.schema.parse({ scores: { unsafe: 1 } }) }
    }
    const run = guardrail.mediaClassifier({
      generate,
      model: 'classifier-model',
      categories: [{ id: 'unsafe', description: 'Unsafe content.' }],
      threshold: 0.8,
      modalities: ['image'],
      unsupported: 'block',
    })
    const findings: SafetyFinding[] = []

    await expect(run(subject('file'), runContext(findings))).resolves.toEqual({
      action: 'allow',
    })
    expect(calls).toBe(0)
    expect(findings).toEqual([])
  })

  it('rethrows the same frozen media capability error when unsupported is omitted', async () => {
    const error = createUnsupportedCapabilityError({
      adapter: 'classifier-adapter',
      model: 'classifier-model',
      issues: [{ capability: 'input.file' }],
    })

    await expect(
      classifier(throwing(error))(subject('file'), runContext([])),
    ).rejects.toBe(error)
    expect(Object.isFrozen(error)).toBe(true)
  })

  it.each([
    ['allow', { action: 'allow' }],
    [
      'warn',
      {
        action: 'warn',
        reason:
          'Media classifier could not inspect this part: adapter "classifier-adapter" model "classifier-model" does not support "input.file".',
      },
    ],
    [
      'block',
      {
        action: 'block',
        reason:
          'Media classifier could not inspect this part: adapter "classifier-adapter" model "classifier-model" does not support "input.file".',
      },
    ],
    [
      'strip',
      {
        action: 'strip',
        reason:
          'Media classifier could not inspect this part: adapter "classifier-adapter" model "classifier-model" does not support "input.file".',
      },
    ],
  ] as const)(
    'handles unsupported media with %s and one score-free finding',
    async (unsupported, expected) => {
      const error = createUnsupportedCapabilityError({
        adapter: 'classifier-adapter',
        model: 'classifier-model',
        issues: [{ capability: 'input.file' }],
      })
      const findings: SafetyFinding[] = []

      await expect(
        classifier(throwing(error), unsupported)(
          subject('file'),
          runContext(findings),
        ),
      ).resolves.toEqual(expected)
      expect(findings).toEqual([{ type: 'media_not_inspected' }])
      expect(JSON.stringify(expected)).not.toContain('Private authored')
      expect(JSON.stringify(expected)).not.toContain('sensitive.pdf')
    },
  )

  const schemaError = z.object({ scores: z.object({ unsafe: z.number() }) })
    .safeParse({ scores: { unsafe: 'invalid' } }).error
  const propagatedErrors = [
    ['structured-output unsupported', new CruxUnsupportedStructuredOutputError('profile')],
    ['provider', new Error('provider failure')],
    ['authentication', Object.freeze({ code: 'authentication_failed' })],
    ['rate limit', Object.freeze({ code: 'rate_limited' })],
    ['schema', schemaError],
    ['timeout', new DOMException('Timed out', 'TimeoutError')],
    ['abort', new DOMException('Aborted', 'AbortError')],
  ] as const

  it.each(propagatedErrors)(
    'propagates %s errors by identity',
    async (_name, error) => {
      await expect(
        classifier(throwing(error), 'allow')(
          subject('image'),
          runContext([]),
        ),
      ).rejects.toBe(error)
    },
  )
})
