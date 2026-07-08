import { describe, expect, it } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import type { StructuredAttempt, StructuredRequest } from '@use-crux/core/adapter'
import { cascade, fallback, router } from '@use-crux/core/routing'
import type { SdkLoopResultLike } from '../src/executor'
import { attemptStructuredGeneration, createStructuredGenerateObjectFn } from '../src/structured-generation'
import { objectGenerationError, scriptedGateway } from './scripted-gateway'

function model(modelId = 'gpt-4o', provider = 'openai'): LanguageModel {
  return { provider, modelId, specificationVersion: 'v3' } as unknown as LanguageModel
}

function structuredRequest(
  schema: z.ZodType,
  overrides: Partial<StructuredRequest<LanguageModel>> = {},
): StructuredRequest<LanguageModel> {
  return {
    model: model(),
    modelInfo: { provider: 'openai', modelId: 'gpt-4o' },
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

type RepairText = (event: { readonly text: string }) => string | null | Promise<string | null>

function requireRepairText(value: unknown): RepairText {
  if (typeof value !== 'function') throw new Error('Expected experimental_repairText to be installed')
  return value as RepairText
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
  it('returns ok with normalized response, raw result, and parsed object', async () => {
    const output = { title: 'ok', count: 1 }
    const scripted = scriptedGateway({
      generateObject: [
        {
          text: JSON.stringify(output),
          object: output,
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
    expect(attempt.object).toEqual(output)
    expect(attempt.raw.object).toEqual(output)
    expect(attempt.response).toMatchObject({
      text: JSON.stringify(output),
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      finishReason: 'stop',
      responseId: 'scripted-resp',
      actualModelId: 'scripted-model',
    })
  })

  it('returns invalid with raw text and a ZodError for AI SDK structured validation errors', async () => {
    const scripted = scriptedGateway({ generateObject: [objectGenerationError('{"title":1}')] })

    const attempt = await attemptStructuredGeneration(
      scripted.gateway,
      structuredRequest(z.object({ title: z.string() })),
    )

    expectInvalid(attempt)
    expect(attempt.rawText).toBe('{"title":1}')
    expect(attempt.error.issues[0]?.message).toContain('response did not match the expected schema')
  })

  it('throws non-validation provider errors unchanged', async () => {
    const providerError = Object.assign(new Error('provider unavailable'), { status: 503 })
    const scripted = scriptedGateway({ generateObject: [providerError] })

    await expect(
      attemptStructuredGeneration(scripted.gateway, structuredRequest(z.object({ title: z.string() }))),
    ).rejects.toBe(providerError)
  })

  it('installs core JSON repair and sends provider-sanitized schemas to the gateway', async () => {
    const schema = z.object({ items: z.array(z.string()).max(2) })
    const scripted = scriptedGateway({ generateObject: [{ object: { items: ['a'] } }] })

    await attemptStructuredGeneration(
      scripted.gateway,
      structuredRequest(schema, {
        model: model('anthropic/claude-sonnet-4-5', 'openrouter'),
        modelInfo: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4-5' },
      }),
    )

    const args = scripted.calls.generateObject[0]!
    const repairText = requireRepairText(args.experimental_repairText)
    await expect(repairText({ text: '```json\n{"items":["a"]}\n```' })).resolves.toBe('{"items":["a"]}')
    expect(args.schema).not.toBe(schema)
    expect(JSON.stringify(args.schema)).not.toContain('maxItems')
  })
})

describe('createStructuredGenerateObjectFn', () => {
  it('reuses structured attempt mechanics and returns only the parsed object', async () => {
    const schema = z.object({ items: z.array(z.string()).max(2) })
    const scripted = scriptedGateway({ generateObject: [{ object: { items: ['a'] } }] })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const result = await generateObject({
      model: model('claude', 'anthropic'),
      system: 'Return JSON.',
      prompt: 'json please',
      schema,
    })

    expect(result).toEqual({ object: { items: ['a'] } })
    const args = scripted.calls.generateObject[0]!
    expect(requireRepairText(args.experimental_repairText)).toBeTypeOf('function')
    expect(args.schema).not.toBe(schema)
    expect(JSON.stringify(args.schema)).not.toContain('maxItems')
  })

  it('preserves router and cascade model resolution for standalone helper calls', async () => {
    const schema = z.object({ accepted: z.boolean() })
    const scripted = scriptedGateway({
      generateObject: [
        { object: { accepted: false } },
        { object: { accepted: false } },
        { object: { accepted: true } },
      ],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)
    const routedModel = router({
      classify: (input) => (input.prompt === 'choose' ? 'fast' : 'default'),
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
    expect(scripted.calls.generateObject.map((args) => modelIdFromArg(args.model))).toEqual(['fast', 'cheap', 'strong'])
  })

  it('falls back to the next model and preserves fallback meta', async () => {
    const schema = z.object({ accepted: z.boolean() })
    const scripted = scriptedGateway({
      generateObject: [
        Object.assign(new Error('rate limited'), { status: 429 }),
        { object: { accepted: true } },
      ],
    })
    const generateObject = createStructuredGenerateObjectFn(scripted.gateway)

    const result = await generateObject({
      model: fallback(model('primary'), model('backup')),
      prompt: 'json please',
      schema,
    })

    expect(result.object).toEqual({ accepted: true })
    expect(scripted.calls.generateObject.map((args) => modelIdFromArg(args.model))).toEqual(['primary', 'backup'])
    const meta = result as unknown as { readonly _meta?: { readonly fallback?: { readonly attempts: number } } }
    expect(meta._meta?.fallback?.attempts).toBe(2)
  })
})
