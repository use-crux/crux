import type {
  DocumentBlock,
  DocumentProducer,
  IngestDiagnostic,
  IngestedDocument,
  SourceCoordinate,
} from '../src/indexing'

function coordinateLabel(coordinate: SourceCoordinate): string {
  switch (coordinate.kind) {
    case 'document':
      return coordinate.documentSha256
    case 'package-part':
      return coordinate.part
    case 'page':
      return String(coordinate.page)
    case 'page-block':
      return String(coordinate.block)
    case 'slide':
      return String(coordinate.slide)
    case 'sheet-range':
      return coordinate.range
    case 'logical-table':
      return String(coordinate.rowStart)
    default: {
      const exhaustive: never = coordinate
      return exhaustive
    }
  }
}

function blockLabel(block: DocumentBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text
    case 'list':
      return String(block.items.length)
    case 'table':
      return String(block.rows.length)
    case 'page':
      return String(block.page)
    case 'slide':
      return String(block.slide)
    case 'sheet':
      return block.sheet
    default: {
      const exhaustive: never = block
      return exhaustive
    }
  }
}

function diagnosticLabel(diagnostic: IngestDiagnostic): string {
  switch (diagnostic.code) {
    case 'parser-downgrade':
      return diagnostic.trigger
    case 'partial-extraction':
      return diagnostic.message
    case 'unsupported-feature':
      return diagnostic.message
    default: {
      const exhaustive: never = diagnostic
      return exhaustive
    }
  }
}

function producerLabel(producer: DocumentProducer): string {
  switch (producer.kind) {
    case 'parser':
      return producer.adapterVersion
    case 'application-operation':
      return producer.operation
    default: {
      const exhaustive: never = producer
      return exhaustive
    }
  }
}

declare const document: IngestedDocument
void coordinateLabel(document.blocks[0]!.coordinate)
void blockLabel(document.blocks[0]!)
void diagnosticLabel(document.diagnostics[0]!)
void producerLabel(document.producer)

// @ts-expect-error Host-owned application operations require a version.
const invalidProducer: DocumentProducer = {
  kind: 'application-operation',
  operation: 'media.describe',
  identity: 'vision',
}

const invalidSchema: IngestedDocument = {
  // @ts-expect-error Schema 1 is not accepted as schema 2.
  schemaVersion: 1,
  source: { documentSha256: 'a'.repeat(64), mediaType: 'text/plain', format: 'txt' },
  producer: { kind: 'parser', name: 'csv-parse', version: '1', adapterVersion: '1' },
  metadata: {},
  blocks: [],
  assets: [],
  diagnostics: [],
}

void invalidProducer
void invalidSchema
