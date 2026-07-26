import { describe, expect, it } from 'vitest'
import type { GenerateObjectFn } from '../../src/compaction'
import {
  guardrail,
  MEDIA_CLASSIFIER_PROMPT_VERSION,
  type MediaPartSubject,
  type SafetyFinding,
  type SafetyRunContext,
} from '../../src/safety'

function inputImage(): MediaPartSubject {
  return {
    part: {
      type: 'image',
      source: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    },
    origin: { kind: 'message', messageIndex: 0, partIndex: 1 },
  }
}

function runContext(findings: SafetyFinding[]): SafetyRunContext {
  return {
    policy: { id: 'media-policy', mode: 'enforce' },
    boundary: { id: 'model.input.media', kind: 'model.input.media' },
    prompt: {},
    model: {},
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: {
      add(finding) {
        findings.push(finding)
      },
    },
  }
}

describe('guardrail.mediaClassifier', () => {
  it.each([
    {
      score: 0.79,
      result: { action: 'allow' },
      findings: [],
    },
    {
      score: 0.8,
      result: {
        action: 'block',
        reason: 'Media classifier matched unsafe (0.80 >= 0.80).',
      },
      findings: [
        {
          type: 'media_classifier_match',
          category: 'unsafe',
          score: 0.8,
          threshold: 0.8,
        },
      ],
    },
  ])(
    'classifies one input image once at score $score',
    async ({ score, result, findings: expectedFindings }) => {
      const calls: unknown[] = []
      const generate: GenerateObjectFn = async (options) => {
        calls.push(options)
        return { object: options.schema.parse({ scores: { unsafe: score } }) }
      }
      const run = guardrail.mediaClassifier({
        generate,
        model: 'classifier-model',
        categories: [
          {
            id: 'unsafe',
            description: 'Content that is unsafe for this application.',
          },
        ],
        threshold: 0.8,
      })
      const findings: SafetyFinding[] = []

      await expect(run(inputImage(), runContext(findings))).resolves.toEqual(
        result,
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        model: 'classifier-model',
        system: expect.any(String),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: expect.any(String) },
              {
                type: 'image',
                source: new Uint8Array([1, 2, 3]),
                mediaType: 'image/png',
              },
            ],
          },
        ],
        schema: expect.anything(),
      })
      expect(findings).toEqual(expectedFindings)
    },
  )

  it('discloses one sanitized file after the ordered rubric', async () => {
    const calls: unknown[] = []
    const generate: GenerateObjectFn = async (options) => {
      calls.push(options)
      return {
        object: options.schema.parse({
          scores: { 'sexual-content': 0.1, 'graphic-violence': 0.2 },
        }),
      }
    }
    const run = guardrail.mediaClassifier({
      generate,
      model: 'classifier-model',
      categories: [
        {
          id: 'sexual-content',
          description: 'Sexual or explicit media or document content.',
        },
        {
          id: 'graphic-violence',
          description: 'Graphic depictions of physical injury or violence.',
        },
      ],
      threshold: 0.8,
    })
    const source = new Uint8Array([4, 5, 6])

    await run(
      {
        part: {
          type: 'file',
          source,
          mediaType: 'application/pdf',
          filename: 'report.pdf',
          providerOptions: {
            protectedProvider: {
              fileId: 'protected-file-id',
              siblingSource: 'https://private.example/sibling.png',
            },
          },
        },
        origin: { kind: 'message', messageIndex: 0, partIndex: 2 },
      },
      runContext([]),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      model: 'classifier-model',
      system: expect.stringMatching(
        /normalized confidence.*criterion is satisfied/i,
      ),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Score these classification criteria independently in the authored order:',
                '1. sexual-content: Sexual or explicit media or document content.',
                '2. graphic-violence: Graphic depictions of physical injury or violence.',
              ].join('\n'),
            },
            {
              type: 'file',
              source,
              mediaType: 'application/pdf',
              filename: 'report.pdf',
            },
          ],
        },
      ],
    })
    expect(calls[0]).not.toEqual(
      expect.objectContaining({
        providerOptions: expect.anything(),
      }),
    )
    expect(JSON.stringify(calls[0])).not.toContain('protected-file-id')
    expect(JSON.stringify(calls[0])).not.toContain('sibling.png')

    const system = (calls[0] as { readonly system: string }).system
    expect(system).toMatch(/classification engine, not a general assistant/i)
    expect(system).toMatch(/untrusted evidence/i)
    expect(system).toMatch(/independent normalized confidence/i)
    expect(system).toMatch(/exactly the supplied category keys/i)
    expect(system).toMatch(/without explanations/i)
    expect(system).not.toContain('Sexual or explicit')
    expect(JSON.stringify(run.strategy)).not.toContain('Sexual or explicit')
    expect(MEDIA_CLASSIFIER_PROMPT_VERSION).toBe('1')
  })
})
