import type { Asset, TranscriptInterval } from '@use-crux/core'
import type { TranscriptionPayload } from '@use-crux/core/adapter'
import type { IngestParser, IngestPart, IngestWarning } from './types'
import { observeIngestMediaCall } from './media-observation'

/** Built-in audio parser backed only by the configured media operation. */
export const audioParser: IngestParser = {
  name: 'audio',
  formats: ['audio'],
  async parse(input, ctx) {
    const transcribe = ctx.media?.transcribe
    if (!transcribe) throw new Error(`Audio source "${input.sourceId}" requires ParserOptions.media.transcribe.`)
    const audio: Asset = input.asset ?? {
      type: 'data', data: input.bytes.slice(), mediaType: audioMediaType(input), ...(input.title ? { filename: input.title } : {}),
    }
    const result = await observeIngestMediaCall(
      'media.transcribe',
      () => transcribe({ audio }),
      { sourceId: input.sourceId },
    )
    const text = typeof result.text === 'string' ? result.text.trim() : ''
    if (!text) throw new Error(`Audio source "${input.sourceId}" returned empty text from media.transcribe.`)
    const segments = validateSegments(result.segments, input.sourceId)
    const warnings = safeWarnings(result)
    const parts = segments.length > 0 ? segmentParts(segments) : [{
      id: 'audio:text:1', kind: 'text' as const, role: 'paragraph' as const, content: text,
    }]
    return {
      parts,
      ...(warnings.length ? { warnings } : {}),
      metadata: {
        ...(validLanguage(result.language) ? { language: result.language } : {}),
        ...(validDuration(result.durationInSeconds) ? { durationInSeconds: result.durationInSeconds } : {}),
      },
    }
  },
}

function validateSegments(segments: TranscriptionPayload<unknown, unknown, unknown>['segments'], sourceId: string): readonly TranscriptInterval[] {
  if (!Array.isArray(segments)) throw new Error(`Audio source "${sourceId}" returned invalid segments from media.transcribe.`)
  let previousEnd = 0
  return segments.map((segment) => {
    if (!segment || typeof segment.text !== 'string' || !segment.text.trim() ||
      !Number.isFinite(segment.startSecond) || !Number.isFinite(segment.endSecond) || segment.startSecond < previousEnd || segment.endSecond < segment.startSecond) {
      throw new Error(`Audio source "${sourceId}" returned invalid seconds segments from media.transcribe.`)
    }
    previousEnd = segment.endSecond
    return { text: segment.text.trim(), startSecond: segment.startSecond, endSecond: segment.endSecond, ...(segment.speaker ? { speaker: segment.speaker } : {}) }
  })
}

function segmentParts(segments: readonly TranscriptInterval[]): IngestPart[] {
  return segments.map((segment, index) => ({
    id: `audio:segment:${index + 1}`,
    kind: 'text',
    role: 'paragraph',
    content: segment.text,
    sourceLocation: { type: 'time', unit: 'seconds', start: segment.startSecond, end: segment.endSecond },
  }))
}

function safeWarnings(result: TranscriptionPayload<unknown, unknown, unknown>): IngestWarning[] {
  return (result.warnings ?? []).flatMap((warning) => {
    if (typeof warning === 'string') return [{ code: 'parser_warning' as const, message: warning.slice(0, 500) }]
    if (!warning || typeof warning !== 'object') return []
    const record = warning as Record<string, unknown>
    const message = typeof record.message === 'string'
      ? record.message
      : typeof record.type === 'string' ? `Transcription warning: ${record.type}` : undefined
    return message ? [{ code: 'parser_warning' as const, message: message.slice(0, 500) }] : []
  })
}

function audioMediaType(input: Parameters<IngestParser['parse']>[0]): string {
  const known = input.asset?.mediaType ?? input.metadata?.contentType ?? input.metadata?.mediaType
  const mediaType = typeof known === 'string' ? known.split(';', 1)[0] : undefined
  if (mediaType?.startsWith('audio/')) return mediaType
  const title = input.title?.toLowerCase() ?? ''
  if (title.endsWith('.wav')) return 'audio/wav'
  if (title.endsWith('.flac')) return 'audio/flac'
  if (title.endsWith('.ogg')) return 'audio/ogg'
  if (title.endsWith('.webm')) return 'audio/webm'
  if (title.endsWith('.m4a')) return 'audio/mp4'
  return 'audio/mpeg'
}

function validLanguage(value: string | undefined): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function validDuration(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
