import { validateOperationExecution, validateOperationTimeout } from '../completed-operation/contracts'
import type { OperationExecution, OperationTimeout } from '../completed-operation/contracts'
import type { TranscriptInterval, TranscriptionResult } from './contracts'
import { createNoTranscriptError } from './errors'

/** Provider-neutral fields accepted before final transcription validation. */
export interface NativeTranscriptionResult<TMetadata = unknown, TWarning = unknown> {
  readonly text: string
  readonly segments?: readonly TranscriptInterval[]
  readonly words?: readonly TranscriptInterval[]
  readonly language?: string
  readonly durationInSeconds?: number
  readonly warnings: readonly TWarning[]
  readonly providerMetadata?: TMetadata
  readonly execution: OperationExecution
}

/** Validate portable transcription controls before provider I/O. */
export function validateTranscribeOptions(options: Readonly<{
  language?: string
  task?: 'transcribe' | Readonly<{ type: 'translate'; targetLanguage: string }>
  timestamps?: string
  prompt?: string
  timeout?: OperationTimeout
}>): void {
  optionalNonEmpty(options.language, 'language')
  optionalNonEmpty(options.prompt, 'prompt')
  if (options.task !== undefined && options.task !== 'transcribe') {
    if (typeof options.task !== 'object' || options.task.type !== 'translate') {
      throw new TypeError('Transcription task must be transcribe or a translate target.')
    }
    optionalNonEmpty(options.task.targetLanguage, 'task.targetLanguage', true)
  }
  if (options.timestamps !== undefined && !['none', 'segment', 'word', 'segment-and-word'].includes(options.timestamps)) {
    throw new TypeError('Transcription timestamps must be none, segment, word, or segment-and-word.')
  }
  validateOperationTimeout(options.timeout)
}

/** Validate semantic success and construct an honest common transcription result. */
export function validateTranscriptionResult<TRaw, TMetadata = unknown, TWarning = unknown>(
  result: NativeTranscriptionResult<TMetadata, TWarning>,
  raw: TRaw,
): TranscriptionResult<TRaw, TMetadata, TWarning> {
  const text = typeof result.text === 'string' ? result.text.trim() : ''
  if (!text) throw createNoTranscriptError(raw)
  const segments = validateIntervals(result.segments ?? [], 'segment')
  const words = validateIntervals(result.words ?? [], 'word')
  optionalNonEmpty(result.language, 'language')
  validateDuration(result.durationInSeconds, segments, words)
  return Object.freeze({
    text,
    segments,
    words,
    warnings: Object.freeze([...result.warnings]),
    execution: validateOperationExecution(result.execution),
    ...(result.language === undefined ? {} : { language: result.language }),
    ...(result.durationInSeconds === undefined ? {} : { durationInSeconds: result.durationInSeconds }),
    ...(result.providerMetadata === undefined ? {} : { providerMetadata: result.providerMetadata }),
    raw,
  })
}

function validateIntervals(intervals: readonly TranscriptInterval[], kind: string): readonly TranscriptInterval[] {
  let previousEnd = 0
  return Object.freeze(intervals.map((interval, index) => {
    const text = interval.text.trim()
    if (!text) throw new TypeError(`Transcription ${kind} ${index} text must be non-empty.`)
    if (!Number.isFinite(interval.startSecond) || !Number.isFinite(interval.endSecond) || interval.startSecond < 0 || interval.endSecond < interval.startSecond) {
      throw new TypeError(`Transcription ${kind} ${index} must use valid seconds.`)
    }
    if (index > 0 && interval.startSecond < previousEnd) {
      throw new TypeError(`Transcription ${kind}s must be ordered and non-overlapping.`)
    }
    optionalNonEmpty(interval.speaker, `${kind}.speaker`)
    previousEnd = interval.endSecond
    return Object.freeze({ ...interval, text })
  }))
}

function validateDuration(
  duration: number | undefined,
  segments: readonly TranscriptInterval[],
  words: readonly TranscriptInterval[],
): void {
  if (duration === undefined) return
  if (!Number.isFinite(duration) || duration < 0) throw new TypeError('Transcription duration must be finite non-negative seconds.')
  const finalEnd = Math.max(segments.at(-1)?.endSecond ?? 0, words.at(-1)?.endSecond ?? 0)
  if (finalEnd > duration) throw new TypeError('Transcription duration must include every interval.')
}

function optionalNonEmpty(value: string | undefined, name: string, required = false): void {
  if ((required || value !== undefined) && !value?.trim()) throw new TypeError(`Transcription ${name} must be non-empty.`)
}
