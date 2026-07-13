/** Tagged failure returned when a provider succeeds without transcript text. */
export type NoTranscriptError = Error & {
  readonly name: 'NoTranscriptError'
  readonly code: 'no_transcript'
  readonly cause?: unknown
}

/** Create a provider-neutral semantic-empty transcription failure. */
export function createNoTranscriptError(cause?: unknown): NoTranscriptError {
  return Object.assign(new Error('Transcription returned no transcript text'), {
    name: 'NoTranscriptError' as const,
    code: 'no_transcript' as const,
    ...(cause === undefined ? {} : { cause }),
  })
}

/** Narrow an unknown failure to the functional no-transcript error tag. */
export function isNoTranscriptError(value: unknown): value is NoTranscriptError {
  return value instanceof Error &&
    (value as Partial<NoTranscriptError>).name === 'NoTranscriptError' &&
    (value as Partial<NoTranscriptError>).code === 'no_transcript'
}
