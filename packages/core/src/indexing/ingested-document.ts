/** Provider-neutral schema-2 ingest document and truthful provenance contracts. */

export type IngestFormat =
  | 'txt'
  | 'md'
  | 'html'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'csv'
  | 'json'
  | 'doc'
  | 'docm'
  | 'docx'
  | 'rtf'
  | 'odt'
  | 'epub'
  | 'ppt'
  | 'pps'
  | 'pot'
  | 'pptx'
  | 'pptm'
  | 'ppsx'
  | 'ppsm'
  | 'odp'
  | 'xls'
  | 'xlsb'
  | 'xlsm'
  | 'xlsx'
  | 'ods'
  | 'unknown'

export type Scalar = string | number | boolean

export interface ParserIdentity {
  readonly kind: 'parser'
  readonly name: 'anydoc' | 'mammoth' | 'pdf-inspector' | 'pdfjs-dist' | 'exceljs' | 'csv-parse'
  readonly version: string
  readonly adapterVersion: string
}

/** Host-owned derived content, never attributed to a parser. */
export interface ApplicationOperationProducer {
  readonly kind: 'application-operation'
  readonly operation: 'media.describe'
  readonly identity: string
  readonly version: string
}

export type DocumentProducer = ParserIdentity | ApplicationOperationProducer

export type SourceCoordinate =
  | { readonly kind: 'document'; readonly documentSha256: string }
  | { readonly kind: 'package-part'; readonly part: string; readonly anchor?: string }
  | { readonly kind: 'page'; readonly page: number }
  | {
      readonly kind: 'page-block'
      readonly page: number
      readonly block: number
      readonly start?: number
      readonly end?: number
    }
  | { readonly kind: 'slide'; readonly slide: number; readonly block?: number }
  | { readonly kind: 'sheet-range'; readonly sheet: string; readonly range: string }
  | { readonly kind: 'logical-table'; readonly rowStart: number; readonly rowEnd: number }

export interface DocumentSource {
  readonly documentSha256: string
  readonly mediaType: string
  readonly format: IngestFormat
}

interface BlockBase {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly headingPath: readonly string[]
  readonly producer: DocumentProducer
}

export interface TextBlock extends BlockBase {
  readonly kind: 'text'
  readonly role: 'heading' | 'paragraph' | 'code' | 'quote' | 'note'
  readonly text: string
  readonly level?: number
  readonly inlines: readonly Inline[]
}

export type Inline =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly coordinate: SourceCoordinate
      readonly producer: DocumentProducer
    }
  | {
      readonly kind: 'link'
      readonly text: string
      readonly target: string
      readonly coordinate: SourceCoordinate
      readonly producer: DocumentProducer
    }

export interface ListBlock extends BlockBase {
  readonly kind: 'list'
  readonly ordered: boolean
  readonly items: readonly ListItem[]
}

export interface ListItem {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly producer: DocumentProducer
  readonly blocks: readonly (TextBlock | ListBlock)[]
}

export interface TableBlock extends BlockBase {
  readonly kind: 'table'
  readonly columns: readonly string[]
  readonly headerRows: number
  readonly rows: readonly (readonly TableCell[])[]
}

export interface TableCell {
  readonly id: string
  readonly coordinate: SourceCoordinate
  readonly producer: DocumentProducer
  readonly row: number
  readonly column: number
  readonly rowSpan: number
  readonly columnSpan: number
  readonly blocks: readonly (TextBlock | ListBlock)[]
  readonly displayedValue?: string
  readonly formula?: string
  readonly mergeRange?: string
}

export interface PageBlock extends BlockBase {
  readonly kind: 'page'
  readonly page: number
  readonly blocks: readonly (TextBlock | ListBlock | TableBlock)[]
}

export interface SlideBlock extends BlockBase {
  readonly kind: 'slide'
  readonly slide: number
  readonly blocks: readonly (TextBlock | ListBlock | TableBlock)[]
  readonly notes: readonly TextBlock[]
}

export interface SheetBlock extends BlockBase {
  readonly kind: 'sheet'
  readonly sheet: string
  readonly range: string
  readonly blocks: readonly TableBlock[]
}

export type DocumentBlock = TextBlock | ListBlock | TableBlock | PageBlock | SlideBlock | SheetBlock

export interface DocumentAsset {
  readonly id: string
  readonly mediaType: string
  readonly sha256: string
  readonly byteLength: number
  readonly coordinate: SourceCoordinate
  readonly producer: DocumentProducer
}

export type IngestDiagnostic =
  | {
      readonly code: 'parser-downgrade'
      readonly severity: 'warning'
      readonly trigger: 'unsupported-feature' | 'invalid-result' | 'parser-crash'
      readonly from: ParserIdentity['name']
      readonly to: ParserIdentity['name']
      readonly producer: ParserIdentity
    }
  | {
      readonly code: 'partial-extraction' | 'unsupported-feature'
      readonly severity: 'warning'
      readonly message: string
      readonly coordinate?: SourceCoordinate
      readonly producer: DocumentProducer
    }

export interface IngestedDocument {
  readonly schemaVersion: 2
  readonly source: DocumentSource
  readonly producer: ParserIdentity
  readonly metadata: Readonly<Record<string, Scalar>>
  readonly blocks: readonly DocumentBlock[]
  readonly assets: readonly DocumentAsset[]
  readonly diagnostics: readonly IngestDiagnostic[]
}

export class IngestedDocumentContractError extends Error {
  readonly code = 'INGESTED_DOCUMENT_CONTRACT_INVALID' as const

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'IngestedDocumentContractError'
  }
}

type RecordValue = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const FORMATS = new Set<IngestFormat>([
  'txt',
  'md',
  'html',
  'pdf',
  'image',
  'audio',
  'video',
  'csv',
  'json',
  'doc',
  'docm',
  'docx',
  'rtf',
  'odt',
  'epub',
  'ppt',
  'pps',
  'pot',
  'pptx',
  'pptm',
  'ppsx',
  'ppsm',
  'odp',
  'xls',
  'xlsb',
  'xlsm',
  'xlsx',
  'ods',
  'unknown',
])
const PARSERS = new Set<ParserIdentity['name']>([
  'anydoc',
  'mammoth',
  'pdf-inspector',
  'pdfjs-dist',
  'exceljs',
  'csv-parse',
])

/** Validates, detaches, and deeply freezes an exact schema-2 document. */
export function validateIngestedDocument(value: unknown): IngestedDocument {
  const record = exact(value, '$', [
    'schemaVersion',
    'source',
    'producer',
    'metadata',
    'blocks',
    'assets',
    'diagnostics',
  ])
  const parsedSource = source(record.source, '$.source')
  const document = freeze({
    schemaVersion: literal(record.schemaVersion, 2, '$.schemaVersion'),
    source: parsedSource,
    producer: parser(record.producer, '$.producer'),
    metadata: metadata(record.metadata, '$.metadata'),
    blocks: array(record.blocks, '$.blocks', block),
    assets: array(record.assets, '$.assets', asset),
    diagnostics: array(record.diagnostics, '$.diagnostics', diagnostic),
  })
  assertDocumentCoordinates(document, parsedSource.documentSha256)
  return document
}

function assertDocumentCoordinates(document: IngestedDocument, documentSha256: string): void {
  for (const [index, block] of document.blocks.entries()) {
    assertBlockCoordinates(block, documentSha256, `$.blocks[${index}]`)
  }
  for (const [index, asset] of document.assets.entries()) {
    assertCoordinateDocument(asset.coordinate, documentSha256, `$.assets[${index}].coordinate`)
  }
  for (const [index, diagnostic] of document.diagnostics.entries()) {
    if (diagnostic.code !== 'parser-downgrade' && diagnostic.coordinate) {
      assertCoordinateDocument(diagnostic.coordinate, documentSha256, `$.diagnostics[${index}].coordinate`)
    }
  }
}

function assertBlockCoordinates(block: DocumentBlock, documentSha256: string, path: string): void {
  assertCoordinateDocument(block.coordinate, documentSha256, `${path}.coordinate`)
  if (block.kind === 'text') {
    for (const [index, inline] of block.inlines.entries()) {
      assertCoordinateDocument(inline.coordinate, documentSha256, `${path}.inlines[${index}].coordinate`)
    }
  }
  if (block.kind === 'list') {
    for (const [index, item] of block.items.entries()) {
      assertCoordinateDocument(item.coordinate, documentSha256, `${path}.items[${index}].coordinate`)
      for (const [nestedIndex, nested] of item.blocks.entries()) {
        assertBlockCoordinates(nested, documentSha256, `${path}.items[${index}].blocks[${nestedIndex}]`)
      }
    }
  }
  if (block.kind === 'table') {
    for (const [rowIndex, row] of block.rows.entries()) {
      for (const [cellIndex, cell] of row.entries()) {
        assertCoordinateDocument(cell.coordinate, documentSha256, `${path}.rows[${rowIndex}][${cellIndex}].coordinate`)
        for (const [nestedIndex, nested] of cell.blocks.entries()) {
          assertBlockCoordinates(
            nested,
            documentSha256,
            `${path}.rows[${rowIndex}][${cellIndex}].blocks[${nestedIndex}]`,
          )
        }
      }
    }
  }
  if (block.kind === 'page' || block.kind === 'slide') {
    for (const [index, nested] of block.blocks.entries()) {
      assertBlockCoordinates(nested, documentSha256, `${path}.blocks[${index}]`)
    }
  }
  if (block.kind === 'slide') {
    for (const [index, note] of block.notes.entries()) {
      assertBlockCoordinates(note, documentSha256, `${path}.notes[${index}]`)
    }
  }
  if (block.kind === 'sheet') {
    for (const [index, nested] of block.blocks.entries()) {
      assertBlockCoordinates(nested, documentSha256, `${path}.blocks[${index}]`)
    }
  }
}

function assertCoordinateDocument(coordinate: SourceCoordinate, documentSha256: string, path: string): void {
  if (coordinate.kind === 'document' && coordinate.documentSha256 !== documentSha256) {
    fail(path, 'must name the ingested document SHA-256')
  }
}

function source(value: unknown, path: string): DocumentSource {
  const record = exact(value, path, ['documentSha256', 'mediaType', 'format'])
  const format = string(record.format, `${path}.format`) as IngestFormat
  if (!FORMATS.has(format)) {
    fail(`${path}.format`, 'must be a supported format')
  }
  return freeze({
    documentSha256: sha256(record.documentSha256, `${path}.documentSha256`),
    mediaType: nonEmpty(record.mediaType, `${path}.mediaType`),
    format,
  })
}

function producer(value: unknown, path: string): DocumentProducer {
  const record = plain(value, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === 'parser') {
    return parser(record, path)
  }
  if (kind === 'application-operation') {
    exact(record, path, ['kind', 'operation', 'identity', 'version'])
    return freeze({
      kind: 'application-operation',
      operation: literal(record.operation, 'media.describe', `${path}.operation`),
      identity: nonEmpty(record.identity, `${path}.identity`),
      version: nonEmpty(record.version, `${path}.version`),
    })
  }
  fail(`${path}.kind`, 'must be parser or application-operation')
}

function parser(value: unknown, path: string): ParserIdentity {
  const record = exact(value, path, ['kind', 'name', 'version', 'adapterVersion'])
  const name = string(record.name, `${path}.name`) as ParserIdentity['name']
  if (!PARSERS.has(name)) {
    fail(`${path}.name`, 'must be a supported parser')
  }
  return freeze({
    kind: literal(record.kind, 'parser', `${path}.kind`),
    name,
    version: nonEmpty(record.version, `${path}.version`),
    adapterVersion: nonEmpty(record.adapterVersion, `${path}.adapterVersion`),
  })
}

function coordinate(value: unknown, path: string): SourceCoordinate {
  const record = plain(value, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === 'document') {
    exact(record, path, ['kind', 'documentSha256'])
    return freeze({ kind, documentSha256: sha256Key(record, 'documentSha256', path) })
  }
  if (kind === 'package-part') {
    exact(record, path, ['kind', 'part'], ['kind', 'part', 'anchor'])
    return freeze({ kind, part: requiredKey(record, 'part', path), ...(optionalKey(record, 'anchor', path) ?? {}) })
  }
  if (kind === 'page') {
    exact(record, path, ['kind', 'page'])
    return freeze({ kind, page: positiveKey(record, 'page', path) })
  }
  if (kind === 'page-block') {
    exact(record, path, ['kind', 'page', 'block'], ['kind', 'page', 'block', 'start', 'end'])
    const start = optionalInteger(record, 'start', path)
    const end = optionalInteger(record, 'end', path)
    if ((start === undefined) !== (end === undefined) || (start !== undefined && end !== undefined && start > end)) {
      fail(path, 'page-block start and end must be an ordered pair')
    }
    return freeze({
      kind,
      page: positiveKey(record, 'page', path),
      block: positiveKey(record, 'block', path),
      ...(start === undefined ? {} : { start, end: end! }),
    })
  }
  if (kind === 'slide') {
    exact(record, path, ['kind', 'slide'], ['kind', 'slide', 'block'])
    return freeze({
      kind,
      slide: positiveKey(record, 'slide', path),
      ...(optionalPositive(record, 'block', path) ?? {}),
    })
  }
  if (kind === 'sheet-range') {
    exact(record, path, ['kind', 'sheet', 'range'])
    return freeze({ kind, sheet: requiredKey(record, 'sheet', path), range: requiredKey(record, 'range', path) })
  }
  if (kind === 'logical-table') {
    exact(record, path, ['kind', 'rowStart', 'rowEnd'])
    const rowStart = nonNegativeKey(record, 'rowStart', path)
    const rowEnd = nonNegativeKey(record, 'rowEnd', path)
    if (rowEnd < rowStart) {
      fail(path, 'logical-table rowEnd must be at least rowStart')
    }
    return freeze({ kind, rowStart, rowEnd })
  }
  fail(`${path}.kind`, 'must be a supported coordinate kind')
}

function block(value: unknown, path: string): DocumentBlock {
  const record = plain(value, path)
  const base = blockBase(record, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === 'text') {
    exact(
      record,
      path,
      ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'role', 'text', 'inlines'],
      ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'role', 'text', 'inlines', 'level'],
    )
    const role = oneOf(record.role, ['heading', 'paragraph', 'code', 'quote', 'note'], `${path}.role`)
    return freeze({
      ...base,
      kind,
      role,
      text: string(record.text, `${path}.text`),
      ...(record.level === undefined ? {} : { level: positive(record.level, `${path}.level`) }),
      inlines: array(record.inlines, `${path}.inlines`, inline),
    })
  }
  if (kind === 'list') {
    exact(record, path, ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'ordered', 'items'])
    return freeze({
      ...base,
      kind,
      ordered: boolean(record.ordered, `${path}.ordered`),
      items: array(record.items, `${path}.items`, listItem),
    })
  }
  if (kind === 'table') {
    exact(record, path, ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'columns', 'headerRows', 'rows'])
    return freeze({
      ...base,
      kind,
      columns: array(record.columns, `${path}.columns`, string),
      headerRows: nonNegative(record.headerRows, `${path}.headerRows`),
      rows: array(record.rows, `${path}.rows`, (row, rowPath) => array(row, rowPath, cell)),
    })
  }
  if (kind === 'page') {
    exact(record, path, ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'page', 'blocks'])
    return freeze({
      ...base,
      kind,
      page: positive(record.page, `${path}.page`),
      blocks: array(record.blocks, `${path}.blocks`, contentBlock),
    })
  }
  if (kind === 'slide') {
    exact(record, path, ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'slide', 'blocks', 'notes'])
    return freeze({
      ...base,
      kind,
      slide: positive(record.slide, `${path}.slide`),
      blocks: array(record.blocks, `${path}.blocks`, contentBlock),
      notes: array(record.notes, `${path}.notes`, textBlock),
    })
  }
  if (kind === 'sheet') {
    exact(record, path, ['id', 'kind', 'coordinate', 'headingPath', 'producer', 'sheet', 'range', 'blocks'])
    return freeze({
      ...base,
      kind,
      sheet: nonEmpty(record.sheet, `${path}.sheet`),
      range: nonEmpty(record.range, `${path}.range`),
      blocks: array(record.blocks, `${path}.blocks`, tableBlock),
    })
  }
  fail(`${path}.kind`, 'must be a supported block kind')
}

function blockBase(record: RecordValue, path: string): BlockBase {
  return {
    id: nonEmpty(record.id, `${path}.id`),
    coordinate: coordinate(record.coordinate, `${path}.coordinate`),
    headingPath: array(record.headingPath, `${path}.headingPath`, string),
    producer: producer(record.producer, `${path}.producer`),
  }
}

function textBlock(value: unknown, path: string): TextBlock {
  const parsed = block(value, path)
  if (parsed.kind !== 'text') {
    fail(`${path}.kind`, 'must be text')
  }
  return parsed
}

function tableBlock(value: unknown, path: string): TableBlock {
  const parsed = block(value, path)
  if (parsed.kind !== 'table') {
    fail(`${path}.kind`, 'must be table')
  }
  return parsed
}

function contentBlock(value: unknown, path: string): TextBlock | ListBlock | TableBlock {
  const parsed = block(value, path)
  if (parsed.kind === 'text' || parsed.kind === 'list' || parsed.kind === 'table') {
    return parsed
  }
  fail(`${path}.kind`, 'must be text, list, or table')
}

function listItem(value: unknown, path: string): ListItem {
  const record = exact(value, path, ['id', 'coordinate', 'producer', 'blocks'])
  return freeze({
    id: nonEmpty(record.id, `${path}.id`),
    coordinate: coordinate(record.coordinate, `${path}.coordinate`),
    producer: producer(record.producer, `${path}.producer`),
    blocks: array(record.blocks, `${path}.blocks`, listContent),
  })
}

function listContent(value: unknown, path: string): TextBlock | ListBlock {
  const parsed = block(value, path)
  if (parsed.kind === 'text' || parsed.kind === 'list') {
    return parsed
  }
  fail(`${path}.kind`, 'must be text or list')
}

function inline(value: unknown, path: string): Inline {
  const record = plain(value, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === 'text') {
    exact(record, path, ['kind', 'text', 'coordinate', 'producer'])
    return freeze({
      kind,
      text: string(record.text, `${path}.text`),
      coordinate: coordinate(record.coordinate, `${path}.coordinate`),
      producer: producer(record.producer, `${path}.producer`),
    })
  }
  if (kind === 'link') {
    exact(record, path, ['kind', 'text', 'target', 'coordinate', 'producer'])
    return freeze({
      kind,
      text: string(record.text, `${path}.text`),
      target: nonEmpty(record.target, `${path}.target`),
      coordinate: coordinate(record.coordinate, `${path}.coordinate`),
      producer: producer(record.producer, `${path}.producer`),
    })
  }
  fail(`${path}.kind`, 'must be text or link')
}

function cell(value: unknown, path: string): TableCell {
  const record = exact(
    value,
    path,
    ['id', 'coordinate', 'producer', 'row', 'column', 'rowSpan', 'columnSpan', 'blocks'],
    [
      'id',
      'coordinate',
      'producer',
      'row',
      'column',
      'rowSpan',
      'columnSpan',
      'blocks',
      'displayedValue',
      'formula',
      'mergeRange',
    ],
  )
  return freeze({
    id: nonEmpty(record.id, `${path}.id`),
    coordinate: coordinate(record.coordinate, `${path}.coordinate`),
    producer: producer(record.producer, `${path}.producer`),
    row: nonNegative(record.row, `${path}.row`),
    column: nonNegative(record.column, `${path}.column`),
    rowSpan: positive(record.rowSpan, `${path}.rowSpan`),
    columnSpan: positive(record.columnSpan, `${path}.columnSpan`),
    blocks: array(record.blocks, `${path}.blocks`, listContent),
    ...(optionalString(record, 'displayedValue', path) ?? {}),
    ...(optionalString(record, 'formula', path) ?? {}),
    ...(optionalString(record, 'mergeRange', path) ?? {}),
  })
}

function asset(value: unknown, path: string): DocumentAsset {
  const record = exact(value, path, ['id', 'mediaType', 'sha256', 'byteLength', 'coordinate', 'producer'])
  return freeze({
    id: nonEmpty(record.id, `${path}.id`),
    mediaType: nonEmpty(record.mediaType, `${path}.mediaType`),
    sha256: sha256(record.sha256, `${path}.sha256`),
    byteLength: nonNegative(record.byteLength, `${path}.byteLength`),
    coordinate: coordinate(record.coordinate, `${path}.coordinate`),
    producer: producer(record.producer, `${path}.producer`),
  })
}

function diagnostic(value: unknown, path: string): IngestDiagnostic {
  const record = plain(value, path)
  const code = string(record.code, `${path}.code`)
  if (code === 'parser-downgrade') {
    exact(record, path, ['code', 'severity', 'trigger', 'from', 'to', 'producer'])
    return freeze({
      code,
      severity: literal(record.severity, 'warning', `${path}.severity`),
      trigger: oneOf(record.trigger, ['unsupported-feature', 'invalid-result', 'parser-crash'], `${path}.trigger`),
      from: parserName(record.from, `${path}.from`),
      to: parserName(record.to, `${path}.to`),
      producer: parser(record.producer, `${path}.producer`),
    })
  }
  if (code === 'partial-extraction' || code === 'unsupported-feature') {
    exact(
      record,
      path,
      ['code', 'severity', 'message', 'producer'],
      ['code', 'severity', 'message', 'coordinate', 'producer'],
    )
    return freeze({
      code,
      severity: literal(record.severity, 'warning', `${path}.severity`),
      message: nonEmpty(record.message, `${path}.message`),
      ...(record.coordinate === undefined ? {} : { coordinate: coordinate(record.coordinate, `${path}.coordinate`) }),
      producer: producer(record.producer, `${path}.producer`),
    })
  }
  fail(`${path}.code`, 'must be a supported diagnostic code')
}

function metadata(value: unknown, path: string): Readonly<Record<string, Scalar>> {
  const record = plain(value, path)
  const result: Record<string, Scalar> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      fail(`${path}.${key}`, 'must be a scalar')
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      fail(`${path}.${key}`, 'must be finite')
    }
    result[key] = item
  }
  return freeze(result)
}

function array<T>(value: unknown, path: string, item: (value: unknown, path: string) => T): readonly T[] {
  if (!Array.isArray(value)) {
    fail(path, 'must be an array')
  }
  return freeze(value.map((entry, index) => item(entry, `${path}[${index}]`)))
}

function exact(value: unknown, path: string, required: string[], alternate?: string[]): RecordValue {
  const record = plain(value, path)
  const keys = Object.keys(record).sort()
  if (!same(keys, required) && (!alternate || !same(keys, alternate))) {
    fail(path, 'must contain exactly the declared keys')
  }
  return record
}

function plain(value: unknown, path: string): RecordValue {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    fail(path, 'must be a plain record')
  }
  const result: RecordValue = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      fail(`${path}.${key}`, 'must not contain accessors or hidden properties')
    }
    result[key] = descriptor.value
  }
  return result
}

function same(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(path, 'must be a string')
  }
  return value
}
function nonEmpty(value: unknown, path: string): string {
  const result = string(value, path)
  if (result.length === 0) {
    fail(path, 'must not be empty')
  }
  return result
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(path, 'must be a boolean')
  }
  return value
}
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(path, 'must be an integer')
  }
  return value
}
function nonNegative(value: unknown, path: string): number {
  const result = integer(value, path)
  if (result < 0) {
    fail(path, 'must be non-negative')
  }
  return result
}
function positive(value: unknown, path: string): number {
  const result = integer(value, path)
  if (result < 1) {
    fail(path, 'must be positive')
  }
  return result
}
function sha256(value: unknown, path: string): string {
  const result = string(value, path)
  if (!SHA256.test(result)) {
    fail(path, 'must be a lowercase SHA-256 digest')
  }
  return result
}
function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) {
    fail(path, `must equal ${String(expected)}`)
  }
  return expected
}
function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  const result = string(value, path) as T
  if (!choices.includes(result)) {
    fail(path, 'must be a supported value')
  }
  return result
}
function requiredKey(record: RecordValue, key: string, path: string): string {
  return nonEmpty(record[key], `${path}.${key}`)
}
function positiveKey(record: RecordValue, key: string, path: string): number {
  return positive(record[key], `${path}.${key}`)
}
function nonNegativeKey(record: RecordValue, key: string, path: string): number {
  return nonNegative(record[key], `${path}.${key}`)
}
function sha256Key(record: RecordValue, key: string, path: string): string {
  return sha256(record[key], `${path}.${key}`)
}
function parserName(value: unknown, path: string): ParserIdentity['name'] {
  const name = string(value, path) as ParserIdentity['name']
  if (!PARSERS.has(name)) {
    fail(path, 'must be a supported parser')
  }
  return name
}
function optionalInteger(record: RecordValue, key: string, path: string): number | undefined {
  return record[key] === undefined ? undefined : nonNegative(record[key], `${path}.${key}`)
}
function optionalPositive(record: RecordValue, key: string, path: string): { block: number } | undefined {
  return record[key] === undefined ? undefined : { block: positive(record[key], `${path}.${key}`) }
}
function optionalKey(record: RecordValue, key: string, path: string): { anchor: string } | undefined {
  return record[key] === undefined ? undefined : { anchor: nonEmpty(record[key], `${path}.${key}`) }
}
function optionalString(record: RecordValue, key: string, path: string): Record<string, string> | undefined {
  return record[key] === undefined ? undefined : { [key]: string(record[key], `${path}.${key}`) }
}
function freeze<T>(value: T): T {
  return Object.freeze(value)
}
function fail(path: string, message: string): never {
  throw new IngestedDocumentContractError(path, message)
}
