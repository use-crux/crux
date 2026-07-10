/**
 * Agent-readable Quality failure artifacts.
 *
 * A failure artifact is the compact machine contract for one failing or
 * errored experiment cell. Experiment records embed these under `failures`
 * so agents can consume one file without re-deriving evidence from the full
 * cell matrix.
 *
 * @module
 */

import type { CellAssertionOutcome } from './experiment'

/** Execution phase responsible for a failed Quality cell. */
export type FailureArtifactPhase = 'expect' | 'afterScores' | 'score' | 'task' | 'timeout' | 'gate'

/** Core-owned fix-surface classification for a failure artifact. */
export type SuggestedFixSurface =
  | 'prompt'
  | 'context'
  | 'retriever'
  | 'tool-schema'
  | 'handoff'
  | 'judge'
  | 'flake'
  | 'unknown'

/** Score evidence included in a failure artifact. */
export interface FailureArtifactScore {
  name: string
  score: number | null
  baselineScore?: number | null
  delta?: number
  rationale?: string
}

/** Dataset provenance included when a cell came from a versioned dataset. */
export interface FailureArtifactDatasetProvenance {
  path: string
  contentFingerprint: string
}

/**
 * One machine-readable failure entry embedded in an Experiment record.
 *
 * The fields intentionally mirror already-redacted cell data. Consumers should
 * treat `input`, `expected`, and `output` as the same persisted snapshots shown
 * in `cells`, not as raw user values.
 */
export interface FailureArtifact {
  caseId: string
  caseName?: string
  variant: string
  trial: number
  phase: FailureArtifactPhase
  input: unknown
  expected?: unknown
  output?: unknown
  scores: readonly FailureArtifactScore[]
  failedOutcomes: readonly CellAssertionOutcome[]
  sourceRef?: string
  covers: readonly string[]
  traceId?: string
  spanIds: readonly string[]
  cassetteId?: string
  cost?: { usd?: number }
  durationMs?: number
  datasetProvenance?: FailureArtifactDatasetProvenance
  suggestedFixSurfaces: readonly SuggestedFixSurface[]
}
