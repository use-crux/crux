/**
 * Authored source-frame contracts for Quality evidence.
 *
 * The core runner owns when source frames are requested, but it does not know
 * how to map generated stack locations back to authored files. First-party
 * tooling supplies a {@link QualitySourceFrameResolver} at the internal runner
 * boundary so `@use-crux/core` stays independent of `@use-crux/indexer` and the local
 * Go server.
 *
 * @module
 */

/** Role assigned to one line within a captured source frame. */
export type QualitySourceFrameLineRole = 'context' | 'failed' | 'passed' | 'not-evaluated'

/** Implementation that resolved an authored source frame. */
export type QualitySourceFrameResolverKind = 'source-map' | 'catalog' | 'disk'

/** Why an authored source frame could not be produced. */
export type QualitySourceUnavailableReason =
  | 'no-source-ref'
  | 'source-map-missing'
  | 'source-file-missing'
  | 'source-outside-project'
  | 'unsupported-language'

/** One line in a narrow authored source-frame snapshot. */
export interface QualitySourceFrameLine {
  /** One-based authored source line number. */
  readonly line: number
  /** Source text for this line, without a trailing newline. */
  readonly text: string
  /** Debugging role for this line within the assertion/check frame. */
  readonly role: QualitySourceFrameLineRole
}

/**
 * Narrow authored-source snapshot captured for a Quality assertion or check.
 *
 * The snapshot stores only a small frame around the authored line plus a hash
 * of that frame. It is safe for local debugging, but it deliberately avoids
 * retaining entire source files in experiment records.
 */
export interface QualitySourceFrameSnapshot {
  readonly kind: 'source-frame'
  /** Original runtime `file:line:column` reference captured from the stack. */
  readonly sourceRef: string
  /** Authored source file after resolver mapping. */
  readonly authoredFile: string
  /** One-based authored source line for the assertion/check. */
  readonly authoredLine: number
  /** Zero-based authored source column when available. */
  readonly authoredColumn?: number
  /** One-based first line included in `lines`. */
  readonly frameStartLine: number
  /** One-based last line included in `lines`. */
  readonly frameEndLine: number
  /** Narrow source frame with the failed/passed/not-evaluated line marked. */
  readonly lines: readonly QualitySourceFrameLine[]
  /** Hash of the captured frame text, used to detect stale snapshots later. */
  readonly contentHash: string
  /** ISO timestamp when the frame was captured. */
  readonly capturedAt: string
  /** True when current source no longer matches this captured snapshot. */
  readonly stale: boolean
  /** Resolver path that produced the authored frame. */
  readonly resolver: QualitySourceFrameResolverKind
}

/** Honest degraded source-frame result when authored source is unavailable. */
export interface QualitySourceUnavailable {
  readonly kind: 'unavailable'
  readonly reason: QualitySourceUnavailableReason
}

/** Source-frame result attached to assertion outcomes and evidence records. */
export type QualitySourceFrame = QualitySourceFrameSnapshot | QualitySourceUnavailable

/** Request passed from the Quality engine to a resolver implementation. */
export interface QualitySourceFrameRequest {
  /** Original runtime `file:line:column` reference captured from the stack. */
  readonly sourceRef: string
  /** Parsed file portion of `sourceRef`; usually generated before resolver mapping. */
  readonly file: string
  /** Parsed one-based line portion of `sourceRef`. */
  readonly line: number
  /** Parsed zero-based column portion of `sourceRef`, when present. */
  readonly column?: number
  /** Number of context lines requested on each side of the assertion/check. */
  readonly frameRadius: number
  /** ISO timestamp the engine wants recorded on the snapshot. */
  readonly capturedAt: string
  /** Role to assign to the resolved authored line. */
  readonly role: QualitySourceFrameLineRole
}

/**
 * Resolver supplied by first-party tooling at the internal runner boundary.
 *
 * Implementations must return authored source only. When they cannot prove
 * the frame is authored source, they return `kind: 'unavailable'` rather than
 * falling back to generated output.
 */
export interface QualitySourceFrameResolver {
  resolveSourceFrame(request: QualitySourceFrameRequest): Promise<QualitySourceFrame>
}
