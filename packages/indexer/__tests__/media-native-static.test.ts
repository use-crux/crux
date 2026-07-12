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
      callNames: ['generateImage', 'transcribe', 'generateSpeech'],
      source: [
        `export const cover = generateImage({ model: 'image-1', prompt: 'private', n: 2, size: '1024x1024', seed: 7 })`,
        `export const transcript = transcribe({ model: 'whisper-1', audio: 'https://private.example/audio.mp3', timestamps: 'segment', diarization: true })`,
        `export const speech = generateSpeech({ model: 'tts-1', text: 'private', voice: 'alloy' })`,
      ].join('\n'),
    })

    expect(nativeFactCount(result.record, 'media.operation')).toBe(3)
    expectNativeExtractionParity(result.nativeOut, result.fallbackOut)
    expect(JSON.stringify(result.nativeOut)).not.toMatch(/private|secret\.example/)
  })

  itWithRustOxc('matches named and nested operations with authored relations', async () => {
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
    expect(result.nativeOut.relations.map((relation) => relation.type)).toEqual(
      expect.arrayContaining(['media.owner', 'media.derives_with']),
    )
  })

  itWithRustOxc('projects only generate and stream calls with proven media', async () => {
    const result = await extractNativeAndFallback({
      callNames: ['generate', 'stream', 'describe'],
      source: [
        `export const vision = generate({ messages: [{ role: 'user', content: [{ type: 'image', source: 'https://private.example/image.png' }] }] })`,
        `export const audio = stream({ messages: [{ role: 'user', content: [{ type: 'audio', source: bytes }] }] })`,
        `export const description = describe({ input: [{ kind: 'video', source: runtimeSource }] })`,
        `export const dynamic = generate({ messages })`,
        `export const plain = stream({ prompt: 'text only' })`,
      ].join('\n'),
    })

    expect(nativeFactCount(result.record, 'media.operation')).toBe(3)
    expectNativeExtractionParity(result.nativeOut, result.fallbackOut)
    expect(result.nativeOut.definitions.map((definition) => definition.name)).toEqual([
      'vision',
      'audio',
      'description',
    ])
  })
})
