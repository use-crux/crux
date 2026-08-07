import { describe, expect, it } from 'vitest'
import { NoOutputGeneratedError, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { ModelInfo } from '@use-crux/core'
import { ValidationExhaustedError } from '@use-crux/core'
import type { StructuredAttempt, StructuredRequest } from '@use-crux/core/adapter'
import { compileStructuredOutput } from '@use-crux/core/adapter'
import { cascade, fallback, FallbackExhaustedError, router } from '@use-crux/core/routing'
import type { SdkLoopResultLike } from '../src/executor'
import { attemptStructuredGeneration, createStructuredGenerateObjectFn } from '../src/structured-generation'
import { aiSdkStructuredCapabilities } from '../src/provider-profile'
import { objectGenerationError, scriptedGateway } from './scripted-gateway'

function model(modelId = 'gpt-4o', provider = 'openai'): LanguageModel {
  return { provider, modelId, specificationVersion: 'v3' } as unknown as LanguageModel
}

/** Compile the wire schema core would install for a model, as the codec expects. */
function wireSchema(schema: z.ZodType, modelInfo: ModelInfo) {
  const caps = aiSdkStructuredCapabilities(modelInfo)
  if (!caps) throw new Error('expected capabilities for test model')
  return compileStructuredOutput(schema, caps).outputSchema
}

function structuredRequest(
  schema: z.ZodType,
  overrides: Partial<StructuredRequest<LanguageModel>> = {},
): StructuredRequest<LanguageModel> {
  const modelInfo = overrides.modelInfo ?? { provider: 'openai', modelId: 'gpt-4o' }
  return {
    model: model(),
    modelInfo,
    system: 'Return JSON.',
    systemBlocks: undefined,
    prompt: 'json please',
    messages: undefined,
    settings: { temperature: 0.2 },
    tools: undefined,
    activeTools: undefined,
    maxSteps: 1,
    observer: undefined,
    abortSignal: undefined,
    extra: undefined,
    schema,
    outputSchema: wireSchema(schema, modelInfo),
    ...overrides,
  }
}

function expectOk(
  attempt: StructuredAttempt<SdkLoopResultLike>,
): asserts attempt is Extract<StructuredAttempt<SdkLoopResultLike>, { status: 'ok' }> {
  if (attempt.status !== 'ok') {
    throw new Error(`Expected structured attempt to be ok, got ${attempt.status}`)
  }
}

function expectInvalid(
  attempt: StructuredAttempt<SdkLoopResultLike>,
): asserts attempt is Extract<StructuredAttempt<SdkLoopResultLike>, { status: 'invalid' }> {
  if (attempt.status !== 'invalid') {
    throw new Error(`Expected structured attempt to be invalid, got ${attempt.status}`)
  }
}

function modelIdFromArg(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (!('modelId' in value)) return undefined
  const modelId = value.modelId
  return typeof modelId === 'string' ? modelId : undefined
}

function acceptedResult(value: unknown): value is { readonly object: { readonly accepted: boolean } } {
  if (value === null || typeof value !== 'object' || !('object' in value)) return false
  const object = value.object
  return object !== null && typeof object === 'object' && 'accepted' in object && typeof object.accepted === 'boolean'
}

describe('attemptStructuredGeneration', () => {
  it('returns ok with normalized response and the parsed wire value', async () => {
    const output = { title: 'ok', count: 1 }
    const scripted = scriptedGateway({
      generateText: [
        {
          text: JSON.stringify(output),
          output,
          usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
          finishReason: 'stop',
        },
      ],
    })

    const attempt = await attemptStructuredGeneration(
      scripted.gateway,
      structuredRequest(z.object({ title: z.string(), count: z.number() })),
    )

    expectOk(attempt)
    expect(attempt.wireValue).toEqual(output)
    expect(attempt.raw.output).toEqual(output)
    expect(attempt.response).toMatchObject({
      text: JSON.stringify(output),
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      finishReason: 'stop',
      responseId: 'scripted-resp',
      actualModelId: 'scripted-model',
    })
  })

  it('returns invalid with raw text and a ZodError for AI SDK structured validation errors', async () => {
    const scripted = scriptedGateway({ generateText: [objectGenerationError('{"title":1}')] })

    const attempt = await attemptStructuredGeneration(
      scripted.gateway,
      structuredRequest(z.object({ title: z.string() })),
    )

    expectInvalid(attempt)
    expect(attempt.rawText).toBe('{"title":1}')
    expect(attempt.error.issues[0]?.message).toContain('response did not match the expected schema')
  })

  it('normalizes AI SDK no-output failures as invalid adapter responses', async () => {
    const scripted = scriptedGateway({ generateText: [new NoOutputGeneratedError()] })

    await expect(
      attemptStructuredGeneration(scripted.gateway, structuredRequest(z.object({ title: z.string() }))),
    ).rejects.toMatchObject({
      name: 'CruxAdapterError',
      providerError: {
        kind: 'invalid-response',
        code: 'ai-sdk.no_output_generated',
        retryable: true,
      },
    })
  })

  it('throws non-validation provider errors unchanged', async () => {
    const providerError = Object.assign(new Error('provider unavailable'), { status: 503 })
    const scripted = scriptedGateway({ generateText: [providerError] })

    await expect(
      attemptStructuredGeneration(scripted.gateway, structuredRequest(z.object({ title: z.string() }))),
    ).rejects.toBe(providerError)
  })

  it('installs the compiled wire schema as an Output, never the authored Zod validator', async () => {
    const schema = z.object({ items: z.array(z.string()).max(2) })
    const scripted = scriptedGateway({ generateText: [{ output: { items: ['a'] } }] })

    const request = structuredRequest(schema, {
      model: model('claude-sonnet-4-5', 'anthropic'),
      modelInfo: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
    })
    await attemptStructuredGeneration(scripted.gateway, request)

    // The structured attempt is a single-step generateText + Output.object; the
    // authored Zod schema is never handed to the SDK as a validator.
    const args = scripted.calls.generateText[0]!
    expect(args.output).toBeDefined()
    expect(args.schema).toBeUndefined()
    // The Anthropic-lowered wire schema drops the array bound the provider rejects.
    expect(JSON.stringify(request.outputSchema)).not.toContain('maxItems')
  })
})

describe('createStructuredGenerateObjectFn', () => {
  it('compiles the wire schema, decodes and authored-parses, returns only the object', async () => {
    const schema = z.object({ items: z.array(z.string()).max(2) })
    const scripted = scriptedGateway({ generateText: [{ output: { items: ['a'] } }] })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const result = await generateObject({
      model: model('claude', 'anthropic'),
      system: 'Return JSON.',
      prompt: 'json please',
      schema,
    })

    expect(result).toEqual({ object: { items: ['a'] } })
    const args = scripted.calls.generateText[0]!
    // Wire schema installed as an Output; the authored Zod schema is not the
    // SDK validator, and the Anthropic-rejected array bound is lowered away.
    expect(args.output).toBeDefined()
    expect(args.schema).toBeUndefined()
  })

  it('preserves ordered canonical media and generation settings', async () => {
    const schema = z.object({ safe: z.boolean() })
    const scripted = scriptedGateway({ generateText: [{ output: { safe: true } }] })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)
    const image = new Uint8Array([1, 2, 3])
    const audio = new Uint8Array([4, 5, 6])
    const video = new URL('https://example.com/clip.mp4')
    const file = new Uint8Array([7, 8, 9])
    const providerOptions = { openai: { detail: 'low' } }

    await generateObject({
      model: model('vision', 'openai'),
      system: 'Classify the supplied media.',
      temperature: 0,
      topP: 0.8,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this image.' },
            { type: 'image', source: image, mediaType: 'image/png' },
            { type: 'audio', source: audio, mediaType: 'audio/mpeg' },
            { type: 'video', source: video, mediaType: 'video/mp4', providerOptions },
            { type: 'file', source: file, mediaType: 'application/pdf', filename: 'report.pdf' },
          ],
        },
      ],
      schema,
    })

    const args = scripted.calls.generateText[0]
    expect(args).toMatchObject({
      system: 'Classify the supplied media.',
      temperature: 0,
      topP: 0.8,
    })
    expect(args?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this image.' },
          { type: 'image', image, mediaType: 'image/png' },
          { type: 'file', data: audio, mediaType: 'audio/mpeg' },
          { type: 'file', data: video, mediaType: 'video/mp4', providerOptions },
          { type: 'file', data: file, mediaType: 'application/pdf', filename: 'report.pdf' },
        ],
      },
    ])
  })

  it('preserves router and cascade model resolution for standalone helper calls', async () => {
    const schema = z.object({ accepted: z.boolean() })
    const scripted = scriptedGateway({
      generateText: [
        { output: { accepted: false } },
        { output: { accepted: false } },
        { output: { accepted: true } },
      ],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)
    const routedModel = router({
      classify: ({ input }: import('@use-crux/core/routing').RouteArgs<object, { prompt: string }>) =>
        input.prompt === 'choose' ? 'fast' : 'default',
      routes: {
        fast: model('fast'),
        default: model('default'),
      },
    })

    const routed = await generateObject({
      model: routedModel,
      prompt: 'choose',
      schema,
    })

    const cascadeModel = cascade({
      tiers: [
        {
          model: model('cheap'),
          evaluate: (result) => acceptedResult(result) && result.object.accepted,
        },
        { model: model('strong') },
      ],
    })

    const cascaded = await generateObject({
      model: cascadeModel,
      prompt: 'escalate',
      schema,
    })

    expect(routed).toMatchObject({ object: { accepted: false } })
    expect(cascaded).toMatchObject({ object: { accepted: true } })
    expect(scripted.calls.generateText.map((args) => modelIdFromArg(args.model))).toEqual(['fast', 'cheap', 'strong'])
  })

  it('falls back to the next model and preserves fallback meta', async () => {
    const schema = z.object({ accepted: z.boolean() })
    const scripted = scriptedGateway({
      generateText: [
        Object.assign(new Error('rate limited'), { status: 429 }),
        { output: { accepted: true } },
      ],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const result = await generateObject({
      model: fallback([model('primary'), model('backup')]),
      prompt: 'json please',
      schema,
    })

    expect(result.object).toEqual({ accepted: true })
    expect(scripted.calls.generateText.map((args) => modelIdFromArg(args.model))).toEqual(['primary', 'backup'])
    expect(result.routing?.trace).toMatchObject([
      {
        kind: 'fallback',
        attempts: [
          { model: 'primary', status: 'error' },
          { model: 'backup', status: 'ok' },
        ],
      },
    ])
  })

  it('falls back on AI SDK no-output structured responses', async () => {
    const scripted = scriptedGateway({
      generateText: [
        new NoOutputGeneratedError(),
        { output: { accepted: true } },
      ],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const result = await generateObject({
      model: fallback([model('primary'), model('backup')], { on: ['invalid_response'] }),
      prompt: 'json please',
      schema: z.object({ accepted: z.boolean() }),
    })

    expect(result.object).toEqual({ accepted: true })
    expect(scripted.calls.generateText.map((args) => modelIdFromArg(args.model))).toEqual(['primary', 'backup'])
    expect(result.routing?.trace).toMatchObject([
      {
        kind: 'fallback',
        attempts: [
          { model: 'primary', status: 'error', errorCategory: 'invalid_response' },
          { model: 'backup', status: 'ok' },
        ],
      },
    ])
  })

  it('retains every no-output attempt when fallback is exhausted', async () => {
    const scripted = scriptedGateway({
      generateText: [new NoOutputGeneratedError(), new NoOutputGeneratedError()],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const error = await generateObject({
      model: fallback([model('primary'), model('backup')], { on: ['invalid_response'] }),
      prompt: 'json please',
      schema: z.object({ accepted: z.boolean() }),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FallbackExhaustedError)
    expect(error).toMatchObject({
      attempts: [
        { model: 'primary', status: 'error', errorCategory: 'invalid_response' },
        { model: 'backup', status: 'error', errorCategory: 'invalid_response' },
      ],
      errors: [{ name: 'CruxAdapterError' }, { name: 'CruxAdapterError' }],
    })
  })

  it('throws ValidationExhaustedError for authored schema parse failures without rejected candidates', async () => {
    const secret = 'leaked-candidate-title'
    const schema = z.object({
      title: z.string().superRefine((value, ctx) => {
        if (value !== 'ok') {
          ctx.addIssue({ code: 'custom', message: `rejected=${value}`, path: [] })
        }
      }),
    })
    const scripted = scriptedGateway({
      generateText: [{ output: { title: secret } }],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const error = await generateObject({
      model: model('primary'),
      prompt: 'json please',
      schema,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect(error).toMatchObject({
      attempts: 0,
      maxAttempts: 0,
      name: 'ValidationExhaustedError',
    })
    const serialized = JSON.stringify(error)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('rejected=')
    expect((error as ValidationExhaustedError).lastOutput.preview).toBeUndefined()
    expect((error as ValidationExhaustedError).issues).toEqual([
      { path: 'title', depth: 1, code: 'custom' },
    ])
  })

  it('falls back on authored schema parse failures under invalid_response', async () => {
    const schema = z.object({ accepted: z.boolean() })
    const scripted = scriptedGateway({
      generateText: [
        { output: { accepted: 'nope' } },
        { output: { accepted: true } },
      ],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const result = await generateObject({
      model: fallback([model('primary'), model('backup')], { on: ['invalid_response'] }),
      prompt: 'json please',
      schema,
    })

    expect(result.object).toEqual({ accepted: true })
    expect(scripted.calls.generateText.map((args) => modelIdFromArg(args.model))).toEqual([
      'primary',
      'backup',
    ])
    expect(result.routing?.trace).toMatchObject([
      {
        kind: 'fallback',
        attempts: [
          { model: 'primary', status: 'error', errorCategory: 'invalid_response' },
          { model: 'backup', status: 'ok' },
        ],
      },
    ])
  })
})
