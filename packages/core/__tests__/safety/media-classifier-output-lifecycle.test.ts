import { describe, expect, it } from 'vitest'
import { bindCompletedOperation } from '../../src/adapter'
import {
  boundary,
  createSafety,
  guardrail,
  type MediaPartSubject,
} from '../../src/safety'
import { guardSafetySessionOutputMedia } from '../../src/safety/session'
import {
  generatedImage,
  imageOperation,
} from '../adapter/completed-operation-safety-image.fixture'
import {
  generatedAudio,
  speechOperation,
} from '../adapter/completed-operation-safety-speech.fixture'
import {
  inputAudio,
  transcriptionOperation,
} from '../adapter/completed-operation-safety-transcription.fixture'
import { classifierHarness } from './media-classifier-lifecycle.fixtures'

describe('media classifier completed-output lifecycle', () => {
  it('classifies generated image, speech audio, and transcription audio', async () => {
    const image = classifierHarness()
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })
    const imageResult = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'classify-generated-image',
          on: boundary.output.media(),
          run: image.run,
        }),
      ],
    })

    const speech = classifierHarness()
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation([]),
      provider: 'test',
      operation: 'generateSpeech',
    })
    const speechResult = await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard.',
      guardrails: [
        guardrail({
          id: 'classify-generated-speech',
          on: boundary.output.media(),
          run: speech.run,
        }),
      ],
    })

    const transcription = classifierHarness()
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation([]),
      provider: 'test',
      operation: 'transcribe',
    })
    const transcriptionResult = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [
        guardrail({
          id: 'classify-transcription-audio',
          on: boundary.input.media(),
          run: transcription.run,
        }),
      ],
    })

    expect(image.parts).toEqual([
      {
        type: 'image',
        source: generatedImage,
        mediaType: 'image/png',
      },
    ])
    expect(speech.parts).toEqual([
      {
        type: 'audio',
        source: generatedAudio,
        mediaType: 'audio/mpeg',
      },
    ])
    expect(transcription.parts).toEqual([
      { type: 'audio', source: inputAudio },
    ])
    expect(imageResult.safety?.guardrails?.applied[0]?.location?.origin)
      .toMatchObject({ operation: 'generateImage', phase: 'output' })
    expect(speechResult.safety?.guardrails?.applied[0]?.location?.origin)
      .toMatchObject({ operation: 'generateSpeech', phase: 'output' })
    expect(
      transcriptionResult.safety?.guardrails?.applied[0]?.location?.origin,
    ).toMatchObject({ operation: 'transcribe', phase: 'input' })
  })

  it('classifies canonical output video and file subjects in order', async () => {
    const harness = classifierHarness()
    const policy = guardrail({
      id: 'classify-generic-output-media',
      on: boundary.output.media(),
      run: harness.run,
    })
    const safety = createSafety({ call: { guardrails: [policy] } })
    const subjects: readonly MediaPartSubject[] = [
      {
        part: {
          type: 'video',
          source: 'https://example.com/output.mp4',
          mediaType: 'video/mp4',
        },
        origin: { kind: 'step', stepIndex: 1, partIndex: 0 },
      },
      {
        part: {
          type: 'file',
          source: new Uint8Array([9]),
          mediaType: 'application/pdf',
          filename: 'output.pdf',
        },
        origin: { kind: 'step', stepIndex: 1, partIndex: 1 },
      },
    ]

    const guarded = await guardSafetySessionOutputMedia(safety, subjects, {
      minimumRetained: 0,
      model: 'output-model',
    })

    expect(guarded.subjects).toEqual(subjects)
    expect(harness.parts.map((part) => part.type)).toEqual(['video', 'file'])
    expect(safety.audit.guardrails?.applied.map((entry) => entry.location))
      .toEqual([
        {
          origin: { kind: 'step', stepIndex: 1, partIndex: 0 },
          partType: 'video',
        },
        {
          origin: { kind: 'step', stepIndex: 1, partIndex: 1 },
          partType: 'file',
        },
      ])
  })

  it('escalates stripping required generated audio with its evidence', async () => {
    const harness = classifierHarness({ action: 'strip', score: () => 0.9 })
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation([]),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const error = await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard.',
      guardrails: [guardrail({
        id: 'classify-required-audio',
        on: boundary.output.media(),
        run: harness.run,
      })],
    }).then(() => undefined, (caught: unknown) => caught)

    expect(harness.parts).toEqual([{
      type: 'audio',
      source: generatedAudio,
      mediaType: 'audio/mpeg',
    }])
    expect(error).toMatchObject({
      decisions: [{
        action: 'block',
        escalatedToBlock: true,
        location: {
          origin: {
            operation: 'generateSpeech',
            phase: 'output',
            field: 'audio',
            partIndex: 0,
          },
          partType: 'audio',
        },
        findings: [{
          type: 'media_classifier_match',
          category: 'unsafe',
          score: 0.9,
          threshold: 0.8,
        }],
      }],
    })
  })
})
