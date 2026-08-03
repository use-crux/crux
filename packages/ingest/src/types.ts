import type { Asset, AssetRef, AudioSource, Message } from '@use-crux/core'
import type { TranscriptionPayload } from '@use-crux/core/adapter'

export type IngestFormat = 'txt' | 'md' | 'html' | 'pdf' | 'image' | 'audio' | 'video' | 'csv' | 'json' | 'docx' | 'xlsx' | 'unknown'

/** Explicit source coordinates retained by derived ingest parts. */
export type IngestSourceLocation =
  | { readonly type: 'page'; readonly pageNumber: number }
  | { readonly type: 'time'; readonly unit: 'seconds'; readonly start: number; readonly end: number }

/** Safe origin facts retained without bytes, provider ids, or delivery credentials. */
export interface IngestSourceFacts {
  readonly url?: string
  readonly path?: string
  readonly assetRef?: AssetRef
  readonly mediaType?: string
}

export type IngestWarningCode =
  | 'unsupported_embedded_object'
  | 'image_ocr_unavailable'
  | 'empty_part'
  | 'partial_extraction'
  | 'parser_warning'

export interface IngestWarning {
  code: IngestWarningCode
  message: string
  partId?: string
  metadata?: Record<string, unknown>
}

export interface IngestError {
  code:
    | 'unsupported_format'
    | 'parse_failed'
    | 'load_failed'
    | 'invalid_document'
    | 'empty_namespace'
    | 'empty_source_id'
  message: string
  stack?: string
  parser?: string
}

export interface IngestPartBase {
  id: string
  sourceId?: string
  content?: string
  metadata?: Record<string, unknown>
  warnings?: IngestWarning[]
  sourceLocation?: IngestSourceLocation
}

export interface IngestTextPart extends IngestPartBase {
  kind: 'text'
  content: string
  role?: 'title' | 'heading' | 'paragraph' | 'list' | 'code' | 'other'
  headingPath?: string[]
}

export interface IngestPagePart extends IngestPartBase {
  kind: 'page'
  content: string
  pageNumber: number
  headingPath?: string[]
}

/** Provider-neutral source facts for one emitted spreadsheet cell. */
export interface IngestSpreadsheetCell {
  /** One-based worksheet row. */
  row: number
  /** One-based worksheet column. */
  column: number
  /** A1 worksheet address. */
  address: string
  /** Displayed value retained in `IngestTablePart.rows`. */
  value: string
  /** Formula expression without the leading `=`, when present. */
  formula?: string
}

/** Provider-neutral source facts for one emitted spreadsheet row. */
export interface IngestSpreadsheetRow {
  /** One-based worksheet row. */
  row: number
  cells: IngestSpreadsheetCell[]
}

/** Exact occupied worksheet bounds represented by a sheet or table part. */
export interface IngestSpreadsheetRange {
  /** A1 range, such as `B2:C4`. */
  address: string
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
}

export interface IngestTablePart extends IngestPartBase {
  kind: 'table'
  content: string
  rows: string[][]
  caption?: string
  columns?: string[]
  pageNumber?: number
  sheetName?: string
  rowStart?: number
  rowEnd?: number
  sourceRange?: IngestSpreadsheetRange
  sourceRows?: IngestSpreadsheetRow[]
}

export interface IngestSheetPart extends IngestPartBase {
  kind: 'sheet'
  content: string
  sheetName: string
  index: number
  sourceRange?: IngestSpreadsheetRange
  tables?: IngestTablePart[]
}

export interface IngestJsonPart extends IngestPartBase {
  kind: 'json'
  content: string
  path: string
  valueType: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
}

export type IngestPart = IngestTextPart | IngestPagePart | IngestTablePart | IngestSheetPart | IngestJsonPart

export interface IngestDocument {
  namespace: string
  sourceId: string
  readonly source?: IngestSourceFacts
  title?: string
  parts: IngestPart[]
  content: string
  metadata?: Record<string, unknown>
  warnings?: IngestWarning[]
}

export type IngestLoadResult =
  | {
      ok: true
      document: IngestDocument
    }
  | {
      ok: false
      namespace: string
      sourceId: string
      error: IngestError
      metadata?: Record<string, unknown>
    }

export interface SourceLoader {
  load(): AsyncIterable<IngestLoadResult>
  documents(): AsyncIterable<IngestDocument>
}

/** Application-owned model operations used to derive ordinary ingest text. */
export interface IngestMediaOperations {
  /** Bound semantic description operation; the application closes over its model/provider. */
  readonly describe?: (input: Readonly<{
    readonly messages: readonly Message[]
    readonly system?: string
    readonly maxOutputTokens?: number
    readonly abortSignal?: AbortSignal
  }>) => Promise<{ readonly text: string }>
  /**
   * Application-owned transcription used by audio ingestion.
   *
   * The port requires provider payload facts only; a managed observed result is
   * also accepted structurally, but custom callbacks never manufacture Crux IDs.
   */
  readonly transcribe?: (input: Readonly<{ audio: AudioSource; abortSignal?: AbortSignal }>) => Promise<
    TranscriptionPayload<unknown, unknown, unknown>
  >
}

export interface IngestParser {
  readonly name: string
  readonly formats: readonly IngestFormat[]
  parse(input: ParseInput, ctx: ParseContext): Promise<ParseResult> | ParseResult
}

export interface ParseInput {
  bytes: Uint8Array
  asset?: Asset
  text?: string
  format: IngestFormat
  sourceId: string
  source?: IngestSourceFacts
  namespace: string
  title?: string
  metadata?: Record<string, unknown>
}

export interface ParseContext {
  media?: IngestMediaOperations
  warn(warning: IngestWarning): void
}

export interface ParseResult {
  title?: string
  parts: IngestPart[]
  metadata?: Record<string, unknown>
  warnings?: IngestWarning[]
}

export interface ParserOptions {
  readonly parsers?: readonly IngestParser[]
  readonly media?: Readonly<IngestMediaOperations>
}
