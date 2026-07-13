/** Test-only transcription support rows shared by first-party adapters. */
export type TranscriptionFixtureAdapter = 'ai-sdk' | 'anthropic' | 'convex' | 'google' | 'openai'

export interface TranscriptionConformanceRow {
  readonly adapter: TranscriptionFixtureAdapter
  readonly support: 'native' | 'composed' | 'exact-ai-re-export' | 'absent'
}

/** Frozen all-five parity expectation; not a public capability registry. */
export const TRANSCRIPTION_CONFORMANCE = Object.freeze([
  Object.freeze({ adapter: 'ai-sdk', support: 'native' }),
  Object.freeze({ adapter: 'anthropic', support: 'absent' }),
  Object.freeze({ adapter: 'convex', support: 'exact-ai-re-export' }),
  Object.freeze({ adapter: 'google', support: 'composed' }),
  Object.freeze({ adapter: 'openai', support: 'native' }),
] satisfies readonly TranscriptionConformanceRow[])

/** Read one adapter expectation from the internal support fixture. */
export function transcriptionConformanceRow(adapter: TranscriptionFixtureAdapter): TranscriptionConformanceRow {
  const row = TRANSCRIPTION_CONFORMANCE.find((candidate) => candidate.adapter === adapter)
  if (!row) throw new Error(`Missing transcription conformance row for ${adapter}.`)
  return row
}
