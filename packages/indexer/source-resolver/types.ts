/**
 * Shared source resolver data contracts.
 *
 * These types describe the stable resolver facade and the internal functional
 * outcomes used by the worker boundary. Runtime JSON still enters through
 * `unknown` and is narrowed by protocol type guards before it reaches these
 * contracts.
 *
 * @module
 */

/** A bundled runtime source location, usually captured from a trace or stack frame. */
export interface SourceLocation {
  /** Bundled file path or file URL. */
  readonly file: string
  /** One-based generated line number. */
  readonly line: number
  /** Zero-based generated column number when available. */
  readonly column?: number
  /** Runtime function name captured with the bundled frame when available. */
  readonly function?: string
}

/** A source location after attempting source-map resolution. */
export interface ResolvedLocation extends SourceLocation {
  /** True when `file`, `line`, and `column` refer to the original source-map position. */
  readonly resolved: boolean
}

/** Original function source extracted from a resolved source-map position. */
export interface ResolvedFnSource {
  /** The extracted original function body. */
  readonly source: string
  /** Original source path from the source map. */
  readonly file: string
  /** One-based start line in the original source. */
  readonly startLine: number
  /** Function source results are only returned when extraction succeeded. */
  readonly resolved: true
}

/** Role assigned to one line within an authored source-frame snapshot. */
export type SourceFrameLineRole = 'context' | 'failed' | 'passed' | 'not-evaluated'

/** One line in a narrow authored source-frame snapshot. */
export interface SourceFrameLine {
  /** One-based authored source line number. */
  readonly line: number
  /** Source text for this line, without a trailing newline. */
  readonly text: string
  /** Debugging role for this line within the frame. */
  readonly role: SourceFrameLineRole
}

/** Resolver path that produced an authored source-frame snapshot. */
export type SourceFrameResolverKind = 'source-map' | 'catalog' | 'disk'

/** Successful authored source-frame snapshot. */
export interface ResolvedSourceFrame {
  readonly kind: 'source-frame'
  readonly sourceRef: string
  readonly authoredFile: string
  readonly authoredLine: number
  readonly authoredColumn?: number
  readonly frameStartLine: number
  readonly frameEndLine: number
  readonly lines: readonly SourceFrameLine[]
  readonly contentHash: string
  readonly capturedAt: string
  readonly stale: boolean
  readonly resolver: SourceFrameResolverKind
}

/** Reason an authored source-frame snapshot could not be produced. */
export type SourceFrameUnavailableReason =
  | 'no-source-ref'
  | 'source-map-missing'
  | 'source-file-missing'
  | 'source-outside-project'
  | 'unsupported-language'

/** Honest degraded source-frame result. */
export interface SourceFrameUnavailable {
  readonly kind: 'unavailable'
  readonly reason: SourceFrameUnavailableReason
}

/** Source-frame resolver result. */
export type SourceFrameResolution = ResolvedSourceFrame | SourceFrameUnavailable

/** Options for resolving a narrow authored source frame. */
export interface SourceFrameOptions {
  /** Runtime `file:line:column` reference to retain on the snapshot. */
  readonly sourceRef?: string
  /** Number of context lines on each side of the authored line. Default `4`. */
  readonly frameRadius?: number
  /** Role to assign to the authored line. Default `failed`. */
  readonly role?: SourceFrameLineRole
  /** ISO capture timestamp. Default current time. */
  readonly capturedAt?: string
}

/** A one-based source position used by pure resolver helpers. */
export interface SourcePosition {
  /** One-based line number. */
  readonly line: number
  /** Zero-based column number. */
  readonly column: number
}

/** Successful source-map discovery with the raw source-map JSON payload. */
export interface FoundSourceMap {
  readonly kind: 'found'
  readonly mapJson: string
  readonly source: 'sidecar' | 'inline' | 'relative-url'
}

/** Reason source-map discovery could not produce a map. */
export type SourceMapDiscoveryFailure =
  | 'bundle-not-readable'
  | 'mapping-url-missing'
  | 'inline-map-invalid'
  | 'relative-map-not-readable'

/** Source-map discovery result. */
export type SourceMapDiscoveryResult =
  | FoundSourceMap
  | { readonly kind: 'not-found'; readonly reason: SourceMapDiscoveryFailure }

/** Reason trace-map parsing or lookup could not produce an original position. */
export type TraceMapResolutionFailure = 'source-map-invalid' | 'original-source-missing' | 'original-line-missing'

/** Original position resolved from a trace map. */
export interface ResolvedTraceMapPosition {
  readonly kind: 'resolved'
  readonly file: string
  readonly line: number
  readonly column?: number
  readonly name?: string
}

/** Trace-map lookup result. */
export type TraceMapResolutionResult =
  | ResolvedTraceMapPosition
  | { readonly kind: 'unresolved'; readonly reason: TraceMapResolutionFailure }

/** Function body extraction result. */
export interface FunctionBodyExtraction {
  /** Extracted source text. */
  readonly source: string
  /** One-based inclusive end line. */
  readonly endLine: number
}
