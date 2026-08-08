import { createHash } from 'node:crypto'
import { validateIngestedDocument } from '@use-crux/core/indexing'
import type { ApplicationOperationProducer, DocumentBlock, DocumentProducer, IngestedDocument, ParserIdentity, SourceCoordinate, TableCell, TextBlock } from '@use-crux/core/indexing'
import type { IngestFormat, IngestPart, ParseResult, ParserOptions } from './types'

const BUILTIN_PRODUCERS: Readonly<Record<'txt' | 'md' | 'html' | 'json', ParserIdentity>> = {
  txt: { kind: 'parser', name: 'text', version: 'builtin', adapterVersion: '2' },
  md: { kind: 'parser', name: 'markdown', version: 'builtin', adapterVersion: '2' },
  html: { kind: 'parser', name: 'html', version: 'builtin', adapterVersion: '2' },
  json: { kind: 'parser', name: 'json', version: 'builtin', adapterVersion: '2' },
}

/** Error raised before an unproven parser result can enter the legacy document path. */
export class IngestEvidenceRequiredError extends Error {
  readonly code = 'evidence_required' as const

  constructor(parser: string) {
    super(`Custom parser "${parser}" must provide schema2.parse with explicit schema-2 evidence.`)
    this.name = 'IngestEvidenceRequiredError'
  }
}

/** Adapts the remaining built-in ParseResult families without inventing offsets. */
export function adaptBuiltInParseResult(input: {
  readonly bytes: Uint8Array
  readonly format: Extract<IngestFormat, 'txt' | 'md' | 'html' | 'json' | 'image' | 'audio' | 'video' | 'unknown'>
  readonly result: ParseResult
  readonly mediaType?: string
  readonly options?: ParserOptions
}): IngestedDocument {
  const documentSha256 = sha256(input.bytes)
  const fallback = input.format === 'unknown' ? BUILTIN_PRODUCERS.txt : BUILTIN_PRODUCERS[input.format as keyof typeof BUILTIN_PRODUCERS]
  const producer = fallback ?? mediaProducer(input.format, input.options)
  const blocks: DocumentBlock[] = input.result.parts.flatMap((part, index) => blockForPart(part, index + 1, documentSha256, producerForPart(part, producer, input.options)))
  const producers = blocks.map((block) => block.producer)
  const documentProducer = producers.find((candidate) => candidate.kind === 'parser') ?? producer

  return validateIngestedDocument({
    schemaVersion: 2,
    source: { documentSha256, mediaType: input.mediaType ?? defaultMediaType(input.format), format: input.format },
    producer: documentProducer,
    metadata: scalarMetadata(input.result.metadata),
    blocks,
    assets: [],
    diagnostics: [],
  })
}

function blockForPart(part: IngestPart, ordinal: number, documentSha256: string, producer: DocumentProducer): DocumentBlock[] {
  const id = `${part.kind}:${documentSha256}:${producerKey(producer)}:block:${ordinal}`
  const coordinate = partCoordinate(part, documentSha256)
  if (part.kind === 'table') {
    return [tableBlock(part, id, coordinate, producer)]
  }
  const content = part.content ?? ''
  if (!content) {
    return []
  }
  return [{
    id,
    kind: 'text' as const,
    coordinate,
    headingPath: part.kind === 'text' ? (part.headingPath ?? []) : [],
    producer,
    role: part.kind === 'text' && part.role === 'heading' ? 'heading' as const : part.kind === 'text' && part.role === 'code' ? 'code' as const : 'paragraph' as const,
    text: content,
    ...(part.kind === 'text' && part.role === 'heading' ? { level: part.headingPath?.length || undefined } : {}),
    inlines: [],
  }]
}

function tableBlock(part: Extract<IngestPart, { kind: 'table' }>, id: string, coordinate: SourceCoordinate, producer: DocumentProducer): DocumentBlock {
  return {
    id,
    kind: 'table' as const,
    coordinate,
    headingPath: [],
    producer,
    columns: part.columns ?? [],
    headerRows: part.columns?.length ? 1 : 0,
    rows: part.rows.map((row, rowIndex) => row.map((value, columnIndex): TableCell => {
      const cellCoordinate = partCoordinateForRow(part, rowIndex + 1, coordinate)
      const cellId = `${id}:row:${rowIndex + 1}:column:${columnIndex + 1}`
      const text: TextBlock = { id: `${cellId}:text`, kind: 'text', coordinate: cellCoordinate, headingPath: [], producer, role: 'paragraph', text: value, inlines: [] }
      return { id: cellId, coordinate: cellCoordinate, producer, row: rowIndex + 1, column: columnIndex + 1, rowSpan: 1, columnSpan: 1, blocks: [text], displayedValue: value }
    })),
  }
}

function partCoordinate(part: IngestPart, documentSha256: string): SourceCoordinate {
  if (part.sourceLocation?.type === 'time') {
    return { kind: 'time', unit: 'seconds', start: part.sourceLocation.start, end: part.sourceLocation.end }
  }
  if (part.sourceLocation?.type === 'page') {
    return { kind: 'page', page: part.sourceLocation.pageNumber }
  }
  return { kind: 'document', documentSha256 }
}

function partCoordinateForRow(part: Extract<IngestPart, { kind: 'table' }>, row: number, fallback: SourceCoordinate): SourceCoordinate {
  if (part.rowStart !== undefined) {
    return { kind: 'logical-table', rowStart: part.rowStart + row - 1, rowEnd: part.rowStart + row - 1 }
  }
  return fallback
}

function mediaProducer(format: IngestFormat, options: ParserOptions | undefined): ApplicationOperationProducer {
  const operation = format === 'audio' ? 'media.transcribe' : 'media.describe'
  const producer = operation === 'media.describe'
    ? options?.mediaProducers?.describe ?? options?.mediaProducer
    : options?.mediaProducers?.transcribe ?? options?.mediaProducer
  if (!producer || producer.operation !== operation) {
    throw new IngestEvidenceRequiredError(`${format} built-in (${operation} producer)`)
  }
  return producer
}

function producerForPart(part: IngestPart, fallback: DocumentProducer, options: ParserOptions | undefined): DocumentProducer {
  if (!part.id.startsWith('video:')) {
    return fallback
  }
  return part.id.startsWith('video:visual:')
    ? mediaProducer('image', options)
    : mediaProducer('audio', options)
}

function scalarMetadata(metadata: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}

function defaultMediaType(format: IngestFormat): string {
  if (format === 'txt' || format === 'md') return 'text/plain'
  if (format === 'html') return 'text/html'
  if (format === 'json') return 'application/json'
  if (format === 'audio') return 'audio/mpeg'
  if (format === 'video') return 'video/mp4'
  if (format === 'image') return 'image/*'
  return 'application/octet-stream'
}

function producerKey(producer: DocumentProducer): string {
  return producer.kind === 'parser'
    ? `${producer.kind}:${producer.name}:${producer.version}:${producer.adapterVersion}`
    : `${producer.kind}:${producer.operation}:${producer.identity}:${producer.version}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
