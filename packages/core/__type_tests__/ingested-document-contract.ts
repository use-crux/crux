import type {
  DocumentBlock,
  DocumentProducer,
  IngestFormat,
  IngestDiagnostic,
  IngestedDocument,
  Inline,
  ParserIdentity,
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
    case 'time':
      return String(coordinate.start)
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

function inlineLabel(inline: Inline): string {
  switch (inline.kind) {
    case 'text':
      return inline.text
    case 'link':
      return inline.target
    default: {
      const exhaustive: never = inline
      return exhaustive
    }
  }
}

function parserNameLabel(name: ParserIdentity['name']): string {
  switch (name) {
    case 'anydoc':
    case 'mammoth':
    case 'pdf-inspector':
    case 'pdfjs-dist':
    case 'exceljs':
    case 'csv-parse':
    case 'text':
    case 'markdown':
    case 'html':
    case 'json':
      return name
    default: {
      const exhaustive: never = name
      return exhaustive
    }
  }
}

function formatLabel(format: IngestFormat): string {
  switch (format) {
    case 'txt':
    case 'md':
    case 'html':
    case 'pdf':
    case 'image':
    case 'audio':
    case 'video':
    case 'csv':
    case 'json':
    case 'doc':
    case 'docm':
    case 'docx':
    case 'rtf':
    case 'odt':
    case 'epub':
    case 'ppt':
    case 'pps':
    case 'pot':
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'ppsm':
    case 'odp':
    case 'xls':
    case 'xlsb':
    case 'xlsm':
    case 'xlsx':
    case 'ods':
    case 'unknown':
      return format
    default: {
      const exhaustive: never = format
      return exhaustive
    }
  }
}

declare const document: IngestedDocument
void coordinateLabel(document.blocks[0]!.coordinate)
void blockLabel(document.blocks[0]!)
void diagnosticLabel(document.diagnostics[0]!)
void producerLabel(document.producer)
void inlineLabel(
  document.blocks[0]!.kind === 'text'
    ? document.blocks[0].inlines[0]!
    : { kind: 'text', text: '', coordinate: { kind: 'page', page: 1 }, producer: document.producer },
)
if (document.producer.kind === 'parser') {
  void parserNameLabel(document.producer.name)
}
void formatLabel(document.source.format)

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
