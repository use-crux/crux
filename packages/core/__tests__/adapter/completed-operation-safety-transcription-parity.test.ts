/** Direct/provider-runtime parity for completed transcription Safety. */

import { describe, expect, it } from 'vitest'
import { bindCompletedOperation, defineProviderRuntime } from '../../src/adapter'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import { boundary, constraint, guardrail } from '../../src/safety'
import { inputAudio, transcriptionOperation } from './completed-operation-safety-transcription.fixture'

describe('completed operation Safety — transcription parity', () => {
  it('applies output guardrails and one-shot constraints through both binders', async () => {
    const outputPolicy = guardrail({
      id: 'transcription-parity-guardrail',
      on: boundary.output.text(),
      run: () => ({
        action: 'rewrite' as const,
        value: 'safe transcript',
        rewrite: { kind: 'redact' as const },
      }),
    })
    const requirement = constraint({
      id: 'transcription-parity-constraint',
      on: boundary.output.text(),
      run: (text) => ({
        pass: text === 'safe transcript',
        ...(text === 'safe transcript' ? {} : { feedback: 'Use the guarded transcript.' }),
      }),
    })
    const direct = bindCompletedOperation({
      definition: transcriptionOperation([]),
      provider: 'test-direct',
      operation: 'transcribe',
    })
    const runtime = transcriptionRuntime().create({})

    const [directResult, runtimeResult] = await Promise.all([
      direct({
        model: 'transcription-model',
        audio: inputAudio,
        guardrails: [outputPolicy],
        constraints: [requirement],
      }),
      runtime.transcribe({
        model: 'transcription-model',
        audio: inputAudio,
        guardrails: [outputPolicy],
        constraints: [requirement],
      }),
    ])

    for (const result of [directResult, runtimeResult]) {
      expect(result.text).toBe('safe transcript')
      expect(result.segments).toEqual([])
      expect(result.words).toEqual([])
      expect(result.safety?.guardrails?.applied).toHaveLength(1)
      expect(result.safety?.constraints?.entries).toHaveLength(1)
      expect(result.safety?.constraints?.allPassed).toBe(true)
    }
  })
})

function transcriptionRuntime() {
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
    transcription: () => transcriptionOperation([]),
  })
}
