import { IMAGE_GENERATION_CONFORMANCE } from './image-generation'
import { SPEECH_CONFORMANCE } from './speech'
import { TRANSCRIPTION_CONFORMANCE } from './transcription'

type Adapter = 'openai' | 'google' | 'anthropic' | 'ai-sdk' | 'convex'
type OperationSupport = 'native' | 'composed' | 'exact-ai-re-export' | 'absent'

interface MediaAdapterConformanceRow {
  readonly adapter: Adapter
  readonly label: string
  readonly imageInput: string
  readonly audioInput: string
  readonly videoInput: string
  readonly documentInput: string
  readonly mixedAssistantMedia: string
  readonly generateImage: string
  readonly transcribe: string
  readonly generateSpeech: string
}

const ADAPTERS = [
  ['openai', 'OpenAI'],
  ['google', 'Google'],
  ['anthropic', 'Anthropic'],
  ['ai-sdk', 'AI SDK'],
  ['convex', 'Convex Agent'],
] as const satisfies readonly (readonly [Adapter, string])[]

const MESSAGE_SUPPORT = {
  openai: ['native', 'audio models', 'unsupported', 'native', 'model-owned'],
  google: ['native', 'native', 'native', 'native', 'model-owned'],
  anthropic: ['native', 'unsupported', 'unsupported', 'native', 'limited native file/tool output'],
  'ai-sdk': ['model-owned', 'model-owned', 'model-owned', 'model-owned', 'model-owned'],
  convex: ['AI SDK-owned', 'AI SDK-owned', 'AI SDK-owned', 'AI SDK-owned', 'AI SDK-owned'],
} as const satisfies Readonly<Record<Adapter, readonly [string, string, string, string, string]>>

function supportFor(
  rows: readonly Readonly<{ adapter: Adapter; support: OperationSupport }>[],
  adapter: Adapter,
): OperationSupport {
  const row = rows.find((candidate) => candidate.adapter === adapter)
  if (!row) throw new Error(`Missing media conformance row for ${adapter}.`)
  return row.support
}

function operationLabel(operation: 'image' | 'transcription' | 'speech', adapter: Adapter): string {
  const rows = operation === 'image'
    ? IMAGE_GENERATION_CONFORMANCE
    : operation === 'transcription'
      ? TRANSCRIPTION_CONFORMANCE
      : SPEECH_CONFORMANCE
  const support = supportFor(rows, adapter)
  if (support === 'absent') return 'absent'
  if (support === 'exact-ai-re-export') return 'exact Crux AI re-export'
  if (operation === 'transcription' && adapter === 'google') return 'honest composition, no word timing/diarization'
  if (operation === 'image' && adapter === 'google') return 'Imagen/Gemini native'
  if (operation === 'speech' && adapter === 'google') return 'native incl. multi-speaker'
  return support
}

/** Tested documentation rows. This remains test-only and is not a capability API. */
export const MEDIA_ADAPTER_MATRIX: readonly MediaAdapterConformanceRow[] = Object.freeze(
  ADAPTERS.map(([adapter, label]) => {
    const [imageInput, audioInput, videoInput, documentInput, mixedAssistantMedia] = MESSAGE_SUPPORT[adapter]
    return Object.freeze({
      adapter,
      label,
      imageInput,
      audioInput,
      videoInput,
      documentInput,
      mixedAssistantMedia,
      generateImage: operationLabel('image', adapter),
      transcribe: operationLabel('transcription', adapter),
      generateSpeech: operationLabel('speech', adapter),
    })
  }),
)

/** Generate the public Markdown matrix from the adapter conformance fixtures. */
export function mediaAdapterMatrixMarkdown(): string {
  const cell = (capability: keyof Omit<MediaAdapterConformanceRow, 'adapter' | 'label'>, label: string) =>
    `| ${label} | ${MEDIA_ADAPTER_MATRIX.map((row) => row[capability]).join(' | ')} |`
  return [
    `| Capability | ${MEDIA_ADAPTER_MATRIX.map((row) => row.label).join(' | ')} |`,
    `| --- | ${MEDIA_ADAPTER_MATRIX.map(() => '---').join(' | ')} |`,
    cell('imageInput', 'Image input'),
    cell('audioInput', 'Audio input'),
    cell('videoInput', 'Video input'),
    cell('documentInput', 'PDF/document input'),
    cell('mixedAssistantMedia', 'Mixed assistant media'),
    cell('generateImage', '`generateImage`'),
    cell('transcribe', '`transcribe`'),
    cell('generateSpeech', '`generateSpeech`'),
  ].join('\n')
}
