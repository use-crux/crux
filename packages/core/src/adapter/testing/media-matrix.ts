import { IMAGE_GENERATION_CONFORMANCE } from './image-generation'
import { TRANSCRIPTION_CONFORMANCE } from './transcription'

type Adapter = 'ai-sdk' | 'anthropic' | 'convex' | 'google' | 'openai'

/** Tested documentation rows. This remains test-only and is not a capability API. */
export const MEDIA_ADAPTER_MATRIX = Object.freeze(([
  ['ai-sdk', 'AI SDK'],
  ['anthropic', 'Anthropic'],
  ['convex', 'Convex Agent'],
  ['google', 'Google'],
  ['openai', 'OpenAI'],
] as const satisfies readonly (readonly [Adapter, string])[]).map(([adapter, label]) => Object.freeze({
  adapter,
  label,
  chat: 'image + file' as const,
  generateImage: IMAGE_GENERATION_CONFORMANCE.find((row) => row.adapter === adapter)!.support,
  transcribe: TRANSCRIPTION_CONFORMANCE.find((row) => row.adapter === adapter)!.support,
})))

/** Generate the public Markdown matrix from the adapter conformance fixtures. */
export function mediaAdapterMatrixMarkdown(): string {
  const operation = (support: 'native' | 'composed' | 'exact-ai-re-export' | 'absent') => ({
    native: 'native',
    composed: 'composed',
    'exact-ai-re-export': 'AI SDK-owned',
    absent: '—',
  })[support]
  return [
    '| Adapter | Chat image/file | `generateImage` | `transcribe` |',
    '| --- | --- | --- | --- |',
    ...MEDIA_ADAPTER_MATRIX.map((row) =>
      `| ${row.label} | ${row.chat} | ${operation(row.generateImage)} | ${operation(row.transcribe)} |`,
    ),
  ].join('\n')
}
