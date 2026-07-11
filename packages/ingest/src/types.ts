import type { Asset, AudioSource, Message, TranscriptionResult } from '@use-crux/core'

export type IngestFormat = 'txt' | 'md' | 'html' | 'pdf' | 'image' | 'audio' | 'csv' | 'json' | 'docx' | 'xlsx' | 'unknown'

/** Explicit source coordinates retained by derived ingest parts. */
export type IngestSourceLocation =
  | { readonly type: 'page'; readonly pageNumber: number }
  | { readonly type: 'time'; readonly unit: 'seconds'; readonly start: number; readonly end: number }

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
}

export interface IngestSheetPart extends IngestPartBase {
  kind: 'sheet'
  content: string
  sheetName: string
  index: number
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
  /** Bound language generation operation; the application closes over its model. */
  readonly generate?: (input: Readonly<{
    messages: readonly Message[]
    system?: string
    maxOutputTokens?: number
  }>) => Promise<{ readonly text: string }>
  /** Bound transcription operation used by audio ingestion. */
  readonly transcribe?: (input: Readonly<{ audio: AudioSource; abortSignal?: AbortSignal }>) => Promise<
    TranscriptionResult<unknown, unknown, unknown>
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
