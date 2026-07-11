import type { TranscriptionResult, TranscriptionSegment } from './contracts'
import { createNoTranscriptError } from './errors'

/** Provider-neutral fields accepted before final transcription validation. */
export interface NativeTranscriptionResult<TMetadata = unknown, TWarning = string> {
  readonly text: string
  readonly segments?: readonly TranscriptionSegment[]
  readonly language?: string
  readonly durationInSeconds?: number
  readonly warnings?: readonly TWarning[]
  readonly metadata?: TMetadata
}

/** Validate semantic success and construct a safe common transcription result. */
export function validateTranscriptionResult<TRaw, TMetadata = unknown, TWarning = string>(
  result: NativeTranscriptionResult<TMetadata, TWarning>,
  raw: TRaw,
): TranscriptionResult<TRaw, TMetadata, TWarning> {
  const text = typeof result.text === 'string' ? result.text.trim() : ''
  if (!text) throw createNoTranscriptError(raw)
  const segments = validateSegments(result.segments ?? [])
  if (result.language !== undefined && !result.language.trim()) throw new TypeError('Transcription language must be non-empty')
  if (result.durationInSeconds !== undefined && (!Number.isFinite(result.durationInSeconds) || result.durationInSeconds < 0)) {
    throw new TypeError('Transcription duration must be finite non-negative seconds')
  }
  if (result.durationInSeconds !== undefined && segments.at(-1)?.end !== undefined && segments.at(-1)!.end > result.durationInSeconds) {
    throw new TypeError('Transcription duration must include every segment')
  }
  return {
    text,
    segments,
    ...(result.language === undefined ? {} : { language: result.language }),
    ...(result.durationInSeconds === undefined ? {} : { durationInSeconds: result.durationInSeconds }),
    ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    raw,
  }
}

function validateSegments(segments: readonly TranscriptionSegment[]): readonly TranscriptionSegment[] {
  let previousEnd = 0
  return segments.map((segment, index) => {
    const text = segment.text.trim()
    if (!text) throw new TypeError(`Transcription segment ${index} text must be non-empty`)
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start) {
      throw new TypeError(`Transcription segment ${index} must use valid seconds`)
    }
    if (index > 0 && segment.start < previousEnd) throw new TypeError('Transcription segments must be ordered and non-overlapping')
    previousEnd = segment.end
    return Object.freeze({ text, start: segment.start, end: segment.end })
  })
}
