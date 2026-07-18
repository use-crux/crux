/** Direct/provider-runtime parity for completed speech Safety. */

import { describe, expect, it } from 'vitest'
import type { GenerateSpeechResult } from '../../src'
import { bindCompletedOperation, defineProviderRuntime } from '../../src/adapter'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import { boundary, guardrail } from '../../src/safety'
import { generatedAudio, speechOperation } from './completed-operation-safety-speech.fixture'

describe('completed operation Safety — speech parity', () => {
  it('preserves completed facts through direct and provider-runtime output Safety', async () => {
    const origins: unknown[] = []
    const policy = guardrail({
      id: 'speech-parity-policy',
      on: boundary.output.media(),
      run: (subject) => {
        origins.push(subject.origin)
        return { action: 'allow' }
      },
    })
    const directValidated: GenerateSpeechResult[] = []
    const direct = bindCompletedOperation({
      definition: speechOperation([], {
        onValidate: (result) => directValidated.push(result),
      }),
      provider: 'test-direct',
      operation: 'generateSpeech',
    })
    const runtimeValidated: GenerateSpeechResult[] = []
    const runtime = speechRuntime(runtimeValidated).create({})

    const directResult = await direct({
      model: 'speech-model',
      text: 'Welcome aboard',
      guardrails: [policy],
    })
    const runtimeResult = await runtime.generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard',
      guardrails: [policy],
    })

    expect(origins).toEqual([speechAudioOrigin, speechAudioOrigin])
    expectCompletedFacts(directResult, directValidated[0])
    expectCompletedFacts(runtimeResult, runtimeValidated[0])
  })
})

const speechAudioOrigin = {
  kind: 'operation',
  operation: 'generateSpeech',
  phase: 'output',
  field: 'audio',
  partIndex: 0,
} as const

function speechRuntime(validated: GenerateSpeechResult[]) {
  const fake = fakeLoopRuntime({ loops: [[{ text: 'unused' }]] })
  return defineProviderRuntime({
    id: 'test-runtime',
    loop: {
      describeModel: fake.runtime.describeModel,
      bind: () => ({
        runTextLoop: fake.runtime.runTextLoop,
        runStructuredAttempt: fake.runtime.runStructuredAttempt,
        runStream: fake.runtime.runStream,
      }),
    },
    speech: () =>
      speechOperation([], {
        onValidate: (result) => validated.push(result),
      }),
  })
}

function expectCompletedFacts(result: GenerateSpeechResult, validated: GenerateSpeechResult | undefined): void {
  if (!validated) throw new Error('Expected speech result validation.')
  expect(result.audio).toBe(generatedAudio)
  expect(result.raw).toBe(validated.raw)
  expect(result.providerMetadata).toBe(validated.providerMetadata)
  expect(result.warnings).toEqual(validated.warnings)
  expect(result.execution).toEqual({ kind: 'native', calls: 1 })
  expect(result.safety?.guardrails?.applied).toHaveLength(1)
  expect(Object.isFrozen(result)).toBe(true)
  expect(Object.isFrozen(result.warnings)).toBe(true)
}
