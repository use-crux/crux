import { expect, it } from 'vitest'
import type { TranscriptionPayload } from '@use-crux/core/adapter'
import { parseDocument } from '../src/parsers'

const producer = (operation: 'media.describe' | 'media.transcribe') => ({
  kind: 'application-operation' as const,
  operation,
  identity: `test:${operation}`,
  version: '1',
})

it.each([
  ['txt', 'A plain document.'],
  ['md', '# Heading\n\nBody'],
  ['html', '<h1>Heading</h1><p>Body</p>'],
  ['json', '{"ready":true}'],
] as const)('normalizes built-in %s parser output into persistable schema-2 evidence', async (format, source) => {
  const document = await parseDocument({ namespace: 'test', sourceId: `source.${format}`, bytes: new TextEncoder().encode(source), format })
  expect(document.evidence).toMatchObject({ documentSha256: expect.stringMatching(/^[0-9a-f]{64}$/), producer: { kind: 'parser' } })
  expect(document.parts.every((part) => part.evidence?.blockIds.length)).toBe(true)
})

it('normalizes image, audio, and video output with the operation that produced each part', async () => {
  const options = {
    media: {
      describe: async () => ({ text: 'Visible diagram.' }),
      transcribe: async () => ({ text: 'Spoken words.', segments: [{ text: 'Spoken words.', startSecond: 0, endSecond: 1 }] } as unknown as TranscriptionPayload<unknown, unknown, unknown>),
    },
    mediaProducers: { describe: producer('media.describe'), transcribe: producer('media.transcribe') },
  }
  const image = await parseDocument({ namespace: 'test', sourceId: 'image.png', bytes: pngBytes(), format: 'image', options })
  const audio = await parseDocument({ namespace: 'test', sourceId: 'audio.mp3', bytes: new Uint8Array([1, 2]), format: 'audio', options })
  const video = await parseDocument({ namespace: 'test', sourceId: 'video.mp4', bytes: new Uint8Array([1, 2]), format: 'video', options })

  expect(image.parts[0]?.evidence?.producer).toEqual(producer('media.describe'))
  expect(audio.parts[0]?.evidence?.coordinate).toEqual({ kind: 'time', unit: 'seconds', start: 0, end: 1 })
  expect(audio.parts[0]?.evidence?.producer).toEqual(producer('media.transcribe'))
  expect(video.parts.map((part) => part.evidence?.producer)).toEqual([producer('media.describe'), producer('media.transcribe')])
})

it('rejects custom parser output before legacy normalization without a schema-2 producer contract', async () => {
  await expect(parseDocument({
    namespace: 'test', sourceId: 'custom.txt', bytes: new TextEncoder().encode('custom'), format: 'txt',
    options: { parsers: [{ name: 'custom', formats: ['txt'], parse: () => ({ parts: [] }) }] },
  })).rejects.toMatchObject({ code: 'evidence_required' })
})

function pngBytes(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
}
