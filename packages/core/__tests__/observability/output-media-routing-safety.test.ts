/** Safe routed-model evidence for output media Safety. */

import { afterEach, describe, expect, it } from 'vitest'
import { createGeneratedImageResult } from '../../src'
import { bindCompletedOperation, defineCompletedOperation } from '../../src/adapter'
import { fallback } from '../../src/generation/fallback'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { safetyDecisionToTurnDecision } from '../../src/observability/turn-decision-report'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'

describe('routed output media Safety evidence', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records only the routed selected model id in audit and observability', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const primary = model('primary-model', 'SECRET_PRIMARY_MODEL')
    const selected = model('selected-model', 'SECRET_SELECTED_MODEL')
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(primary),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: fallback([primary, selected], { shouldFallback: () => true }),
      prompt: 'Draw a safe shape.',
      guardrails: [
        guardrail({
          id: 'audit-selected-model',
          on: boundary.output.media(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    })
    await observe.flush()

    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'audit-selected-model',
      model: 'selected-model',
    })
    expect(result.warnings[0]).toMatchObject({ message: 'SECRET_WARNING_IMAGE' })
    expect(result.providerMetadata).toMatchObject({ duplicate: 'SECRET_PROVIDER_IMAGE' })
    expect(result.raw).toMatchObject({ duplicate: 'SECRET_RAW_IMAGE' })
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'guardrail.run',
        name: 'audit-selected-model',
        attributes: expect.objectContaining({ model: 'selected-model' }),
      }),
    )
    const serialized = JSON.stringify({ audit: result.safety, observations: transport.records })
    for (const sentinel of [
      'SECRET_PRIMARY_MODEL',
      'SECRET_SELECTED_MODEL',
      'SECRET_WARNING_IMAGE',
      'SECRET_PROVIDER_IMAGE',
      'SECRET_RAW_IMAGE',
      '"0":7',
    ]) {
      expect(serialized).not.toContain(sentinel)
    }
  })

  it('projects only the routed selected model id into a terminal TDR row', async () => {
    setObservabilityTransport(createInMemoryObservabilityTransport(), { scheduledDelayMs: 0 })
    const primary = model('primary-model', 'SECRET_PRIMARY_TDR_MODEL')
    const selected = model('selected-model', 'SECRET_SELECTED_TDR_MODEL')
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(primary),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: fallback([primary, selected], { shouldFallback: () => true }),
      prompt: 'Draw a blocked shape.',
      guardrails: [
        guardrail({
          id: 'block-selected-model',
          on: boundary.output.media(),
          run: () => ({ action: 'block', reason: 'Image is outside policy.' }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    if (!(error instanceof GuardrailBlockedError)) throw error
    expect(error.decisions[0]).toMatchObject({ model: 'selected-model' })
    const decision = safetyDecisionToTurnDecision(error.decisions[0]!)
    expect(decision).toMatchObject({ model: 'selected-model' })
    expect(JSON.stringify(decision)).not.toContain('SECRET_')
  })
})

interface RoutedModel {
  readonly id: string
  readonly secret: string
}

function model(id: string, secret: string): RoutedModel {
  return Object.freeze({ id, secret })
}

function routedImageOperation(primary: RoutedModel) {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ model: RoutedModel; prompt: string }>) => input,
    support: () => 'supported' as const,
    async invoke(input, context) {
      if (input.model === primary) throw new Error('Try the next model.')
      return context.call('image.generate', async () =>
        Object.freeze({ requestId: 'selected', duplicate: 'SECRET_RAW_IMAGE' }),
      )
    },
    validate(raw) {
      return createGeneratedImageResult(
        [
          Object.freeze({
            type: 'data',
            data: new Uint8Array([7, 8, 9]),
            mediaType: 'image/png',
          }),
        ],
        {
          warnings: Object.freeze([{ message: 'SECRET_WARNING_IMAGE' }]),
          providerMetadata: Object.freeze({
            requestId: raw.requestId,
            duplicate: 'SECRET_PROVIDER_IMAGE',
          }),
          execution: { kind: 'native', calls: 1 },
          raw,
        },
      )
    },
    report: () => ({ kind: 'image' as const, count: 1 }),
    conformance: [],
  })
}
