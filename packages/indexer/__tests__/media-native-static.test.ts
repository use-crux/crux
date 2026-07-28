import { describe, expect } from 'vitest'
import {
  expectNativeExtractionParity,
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from './native-first-party-fixture-helpers'

describe('authored media native static parity', () => {
  itWithRustOxc('matches specialized literal media operations', async () => {
    const result = await extractNativeAndFallback({
      callNames: [
        'generateImage',
        'streamImage',
        'transcribe',
        'generateSpeech',
        'streamSpeech',
      ],
      source: [
        `import { streamImage } from '@use-crux/openai'`,
        `import { streamSpeech } from '@use-crux/google'`,
        `export const cover = generateImage({ model: 'image-1', prompt: 'private', n: 2, size: '1024x1024', seed: 7 })`,
        `export const preview = streamImage({ model: 'image-1', prompt: 'private stream', n: 1 })`,
        `export const transcript = transcribe({ model: 'whisper-1', audio: 'https://private.example/audio.mp3', task: { type: 'translate', targetLanguage: 'SECRET_LANGUAGE' }, timestamps: 'segment', diarization: true })`,
        `export const speech = generateSpeech({ model: 'tts-1', text: 'private', voice: 'alloy' })`,
        `export const audio = streamSpeech({ model: 'tts-stream', text: 'private stream speech', voice: 'Kore' })`,
      ].join('\n'),
    })

    expect(nativeFactCount(result.record, 'media.operation')).toBe(5)
    expectNativeExtractionParity(result.nativeOut, result.fallbackOut)
    expect(
      result.nativeOut.definitions.find(
        (definition) => definition.name === 'transcript',
      )?.metadata?.facts,
    ).toMatchObject({ authoredOptions: { task: 'translate' } })
    expect(
      result.nativeOut.definitions
        .filter((definition) => ['preview', 'audio'].includes(definition.name))
        .map((definition) => definition.metadata?.facts),
    ).toEqual([
      expect.objectContaining({ adapter: 'openai', execution: 'native' }),
      expect.objectContaining({ adapter: 'google', execution: 'native' }),
    ])
    expect(JSON.stringify(result.nativeOut)).not.toMatch(
      /private|secret\.example|SECRET_LANGUAGE/,
    )
  })

  itWithRustOxc(
    'matches named and nested operations with authored relations',
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ['fileSource', 'generateSpeech', 'generateImage'],
        source: [
          `const reusable = generateSpeech({ model: 'tts-1', text: 'private' })`,
          `export const pipeline = fileSource('/private/input.png', { mediaKinds: ['image'], attribution: ['page'], derivation: reusable, preview: generateImage({ prompt: dynamicPrompt }) })`,
        ].join('\n'),
      })

      expect(nativeFactCount(result.record, 'media.operation')).toBe(2)
      expect(nativeFactCount(result.record, 'ingest.source')).toBe(1)
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut)
      expect(
        result.nativeOut.relations.map((relation) => relation.type),
      ).toEqual(expect.arrayContaining(['media.owner', 'media.derives_with']))
    },
  )

  itWithRustOxc(
    'projects only generate and stream calls with proven media',
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ['generate', 'stream', 'describe'],
        source: [
          `import { generate, stream } from '@use-crux/ai'`,
          `import { prompt } from '@use-crux/core'`,
          `const mediaPrompt = prompt({ id: 'media' })`,
          `export const vision = generate(mediaPrompt, { model: 'vision-model', messages: [{ role: 'user', content: [{ type: 'image', source: 'https://private.example/image.png' }] }] })`,
          `export const audio = stream(mediaPrompt, { model: 'audio-model', messages: [{ role: 'user', content: [{ type: 'audio', source: bytes }] }] })`,
          `export const description = describe({ input: [{ kind: 'video', source: runtimeSource }] })`,
          `export const dynamic = generate(mediaPrompt, { model: 'vision-model', messages })`,
          `export const plain = stream(mediaPrompt, { model: 'text-model' })`,
        ].join('\n'),
      })

      expect(nativeFactCount(result.record, 'media.operation')).toBe(3)
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut)
      expect(
        result.nativeOut.definitions.map((definition) => definition.name),
      ).toEqual(['vision', 'audio', 'description'])
      expect(
        result.nativeOut.definitions
          .slice(0, 2)
          .map((definition) => definition.metadata?.facts),
      ).toEqual([
        expect.objectContaining({ adapter: 'ai-sdk', model: 'vision-model' }),
        expect.objectContaining({ adapter: 'ai-sdk', model: 'audio-model' }),
      ])
    },
  )
})
