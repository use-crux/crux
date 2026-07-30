import type {
  PromptTextDocumentStamp,
  Utf16Position,
  Utf16Range,
} from '../contracts.js'
import type { PromptTextPreviewOffsetRange } from './range.js'

/** Exact open-source identity used to reject stale static-preview responses. */
export interface PromptTextPreviewSource {
  readonly uri: string
  readonly sourcePath: string
  readonly openEpoch: number
  readonly version: number
  readonly sourceHash: string
  readonly documentLength: number
  offsetAt(position: Utf16Position): number | undefined
  positionAt(offset: number): Utf16Position | undefined
}

/** One active virtual resource keyed by source URI and current exact range. */
export interface PromptTextPreviewSlot {
  readonly id: number
  readonly sourceUri: string
  readonly sourcePath: string
  readonly initialLine: number
  readonly range: Utf16Range
}

/** Outcome of publishing bytes across VS Code's virtual-document boundary. */
export type PromptTextPreviewPublishResult =
  | 'exact'
  | 'analysis-unavailable'
  | 'editor-eol-normalization'
  | 'resource-disposed'

/** Process and editor operations owned outside the pure preview state machine. */
export interface PromptTextPreviewControllerPorts {
  /** Return only the exact currently open source snapshot for `uri`. */
  currentSource(uri: string): PromptTextPreviewSource | undefined
  /** Pull one result; cancellation discards work and never authorizes reuse. */
  request(
    params: PromptTextPreviewStaticParams,
    signal: AbortSignal,
  ): Promise<PromptTextPreviewStaticResult | undefined>
  /** Present request-local choices without assigning durable identity. */
  choose(
    choices: readonly PromptTextPreviewSelection[],
  ): Promise<PromptTextPreviewSelection | undefined>
  /** Publish and byte-verify content, optionally revealing the resource. */
  publish(
    slot: PromptTextPreviewSlot,
    ready: PromptTextPreviewReadyResult,
    reveal: boolean,
  ): Promise<PromptTextPreviewPublishResult>
  /** Replace retained bytes with one explicit unavailable state. */
  clear(
    slot: PromptTextPreviewSlot,
    reason: PromptTextPreviewUnavailableReason,
  ): void
  /** Clear retained bytes while fresh analysis is pending. */
  refreshing(slot: PromptTextPreviewSlot): void
  showInformation(message: string): void
}

/** Controller-private mutable state for one retained virtual resource. */
export interface MutablePromptTextPreviewSlot {
  readonly id: number
  readonly sourceUri: string
  readonly sourcePath: string
  readonly initialLine: number
  range: Utf16Range
  offsets: PromptTextPreviewOffsetRange
  documentLength: number
  generation: number
  tracked: boolean
  refreshTimer?: ReturnType<typeof setTimeout>
}

/** Selects a template from the exact current PromptText analysis. */
export type PromptTextPreviewTarget =
  | {
      readonly kind: 'position'
      readonly position: Utf16Position
    }
  | {
      readonly kind: 'template-range'
      readonly range: Utf16Range
    }

/** Exact stamped request for one static PromptText preview. */
export interface PromptTextPreviewStaticParams extends PromptTextDocumentStamp {
  readonly protocolVersion: 1
  readonly target: PromptTextPreviewTarget
}

/** One request-local template choice. Ordinal is presentation, not identity. */
export interface PromptTextPreviewSelection {
  readonly ordinal: number
  readonly range: Utf16Range
}

/** Closed failure vocabulary owned by the Go language server. */
export type PromptTextPreviewServerUnavailableReason =
  | 'document-not-open'
  | 'revision-mismatch'
  | 'analysis-unavailable'
  | 'request-unsupported'
  | 'template-not-found'
  | 'template-ambiguous'
  | 'template-unsupported'
  | 'preview-unavailable'

/** Closed failure vocabulary owned by the VS Code lifecycle. */
export type PromptTextPreviewClientUnavailableReason =
  | 'analysis-unavailable'
  | 'editor-eol-normalization'
  | 'source-closed'
  | 'target-lost'

/** Combined slot metadata reasons; only server reasons cross the wire. */
export type PromptTextPreviewUnavailableReason =
  | PromptTextPreviewServerUnavailableReason
  | PromptTextPreviewClientUnavailableReason

/** Structural completeness of a request or selected template. */
export type PromptTextPreviewStructuralStatus = 'complete' | 'truncated'
/** Completeness of the projected preview byte string. */
export type PromptTextPreviewContentStatus = 'complete' | 'truncated'
/** Strongest exact evidence contributing projected bytes. */
export type PromptTextPreviewEvidence = 'syntax-exact' | 'semantic-exact'

/** Bound responsible for a whole-segment preview truncation. */
export interface PromptTextPreviewTruncation {
  readonly reason: 'max-preview-bytes' | 'max-fragment-depth'
  readonly limit: number
  readonly emittedBytes: number
}

interface PromptTextPreviewStaticResultBase extends PromptTextDocumentStamp {
  readonly protocolVersion: 1
}

/** Exact preview bytes plus independent structural and content status. */
export interface PromptTextPreviewReadyResult extends PromptTextPreviewStaticResultBase {
  readonly kind: 'ready'
  readonly selection: PromptTextPreviewSelection
  readonly requestStatus: PromptTextPreviewStructuralStatus
  readonly templateStatus: PromptTextPreviewStructuralStatus
  readonly previewStatus: PromptTextPreviewContentStatus
  readonly evidence: PromptTextPreviewEvidence
  readonly text: string
  readonly truncation?: PromptTextPreviewTruncation
}

/** Request-local choices that require an exact range rematch. */
export interface PromptTextPreviewChooseResult extends PromptTextPreviewStaticResultBase {
  readonly kind: 'choose'
  readonly requestStatus: PromptTextPreviewStructuralStatus
  readonly choices: readonly PromptTextPreviewSelection[]
}

/** Server-owned unavailable response carrying no preview bytes. */
export interface PromptTextPreviewUnavailableResult extends PromptTextPreviewStaticResultBase {
  readonly kind: 'unavailable'
  readonly reason: PromptTextPreviewServerUnavailableReason
}

/** Closed static-preview response from the Crux language server. */
export type PromptTextPreviewStaticResult =
  | PromptTextPreviewReadyResult
  | PromptTextPreviewChooseResult
  | PromptTextPreviewUnavailableResult
