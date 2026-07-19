/** Safe audit, observability, and turn-report evidence for output media Safety. */

import { afterEach, describe, expect, it } from 'vitest'
import { resetHooks, setHooks } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { safetyDecisionToTurnDecision } from '../../src/observability/turn-decision-report'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { speechOperation } from '../adapter/completed-operation-safety-speech.fixture'
import { imageOperation } from '../adapter/completed-operation-safety-image.fixture'

describe('output media Safety evidence', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('retains the exact operation origin when required-media strip escalates', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation([]),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const error = await generateSpeech({
      model: 'speech-model',
      text: 'Read this.',
      guardrails: [
        guardrail({
          id: 'strip-required-speech',
          on: boundary.output.media(),
          run: () => ({ action: 'strip', reason: 'Audio is outside policy.' }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    if (!(error instanceof GuardrailBlockedError)) throw error
    expect(error.decisions[0]).toMatchObject({
      action: 'block',
      escalatedToBlock: true,
      location: {
        origin: {
          kind: 'operation',
          operation: 'generateSpeech',
          phase: 'output',
          field: 'audio',
          partIndex: 0,
        },
        partType: 'audio',
      },
    })
    expect(safetyDecisionToTurnDecision(error.decisions[0]!)).toMatchObject({
      outcome: 'block',
      escalatedToBlock: true,
      location: {
        origin: {
          kind: 'operation',
          operation: 'generateSpeech',
          phase: 'output',
          field: 'audio',
          partIndex: 0,
        },
        partType: 'audio',
      },
    })
    await observe.flush()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        attributes: expect.objectContaining({
          action: 'strip',
          escalatedToBlock: true,
        }),
      }),
    )
  })

  it('serializes dormant and disabled bindings as distinct timeline entries', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    setHooks({
      globalGuardrails: [
        guardrail({
          id: 'dormant-output-text',
          on: boundary.output.text(),
          run: () => ({ action: 'allow' }),
        }),
        guardrail({
          id: 'disabled-output-media',
          on: boundary.output.media(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'Draw a safe shape.',
      safety: { tune: { 'disabled-output-media': { enabled: false } } },
    })
    await observe.flush()

    expect(result.safety?.guardrails?.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          boundary: 'model.output.text',
          action: 'dormant',
          reason: 'Global policy is dormant for generateImage at model.output.text.',
        }),
        expect.objectContaining({
          boundary: 'model.output.media',
          action: 'allow',
          reason: 'disabled by call site',
        }),
      ]),
    )
    const reports = transport.records.filter(
      (record) => record.type === 'artifact' && record.kind === 'guardrail.report',
    )
    expect(reports.map((report) => report.preview)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'dormant' }),
        expect.objectContaining({
          action: 'allow',
          reason: 'disabled by call site',
        }),
      ]),
    )
  })
})
