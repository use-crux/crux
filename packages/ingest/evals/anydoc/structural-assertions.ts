import { createHash } from 'node:crypto'
import type { DocumentBlock, DocumentProducer, IngestedDocument, ListBlock, ListItem, SourceCoordinate, TableBlock, TextBlock } from '@use-crux/core/indexing'

export type AssertionRole = 'required' | 'informational'

export type EvaluationOutcome =
  | { readonly kind: 'success'; readonly diagnostic?: 'external-resource-blocked' }
  | { readonly kind: 'failure'; readonly error: string }
  | { readonly kind: 'missing'; readonly reason?: string }

type StructuralFactAssertion =
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'ordered-text'; readonly text: readonly string[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'list'; readonly ordered: boolean; readonly depth: number; readonly text: readonly string[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'link'; readonly text: string; readonly target: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'notes'; readonly text: readonly string[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'slide-note'; readonly slide: number; readonly text: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'asset-count'; readonly count: number }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'coordinate-kinds'; readonly kinds: readonly SourceCoordinate['kind'][] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'slide-order'; readonly slides: readonly number[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'slide-boundary'; readonly slide: number; readonly text: readonly string[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'sheet-order'; readonly sheets: readonly string[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'sheet-range'; readonly sheet: string; readonly range: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'cell'; readonly sheet: string; readonly address: string; readonly displayedValue: string; readonly formula?: string; readonly mergeRange?: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'csv-matrix'; readonly matrix: readonly (readonly string[])[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'logical-row-bounds'; readonly start: number; readonly end: number }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'page-order'; readonly pages: readonly number[] }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'page-block'; readonly page: number; readonly block: number; readonly text: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'page-content-hash'; readonly page: number; readonly sha256: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'metadata'; readonly key: string; readonly value: string | number | boolean }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'parser-downgrade'; readonly from: string; readonly to: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'no-parser-downgrade' }

export type StructuralAssertion =
  | (StructuralFactAssertion & { readonly factPath: string })
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'provenance'; readonly for: string; readonly path: string; readonly coordinate: SourceCoordinate; readonly producer: DocumentProducer }

export interface ExpectedFactManifest {
  readonly fixtureId: string
  readonly expectedOutcome: EvaluationOutcome
  readonly assertions: readonly StructuralAssertion[]
}

export interface AssertionResult {
  readonly id: string
  readonly role: AssertionRole
  readonly passed: boolean
  readonly expected: unknown
  readonly actual: unknown
}

export interface StructuralAssertionResult {
  readonly fixtureId: string
  readonly passed: boolean
  readonly admitted: boolean
  readonly assertions: readonly AssertionResult[]
}

/** Parser-adapter facts are typed but intentionally independent from Core's document model. */
type ParserNativeFactValue = StructuralAssertion extends infer Fact
  ? Fact extends unknown ? Omit<Fact, 'id' | 'role' | 'factPath' | 'for'> : never
  : never

export type ParserNativeFact = ParserNativeFactValue & {
  /** Parser-owned structural location, retained for duplicate-kind disambiguation. */
  readonly factPath: string
}

export interface ParserNativeFacts {
  readonly outcome: EvaluationOutcome
  readonly facts: readonly ParserNativeFact[]
}

/** Assert a parser's native typed fact surface before its Core projection exists. */
export function assertParserNativeFacts(expected: ExpectedFactManifest, actual: ParserNativeFacts): StructuralAssertionResult {
  const results = [outcomeResult(expected.expectedOutcome, actual.outcome)]
  for (const assertion of expected.assertions) {
    const expectedPath = assertion.kind === 'provenance' ? assertion.path : assertion.factPath
    const expectedValue = assertion.kind === 'provenance'
      ? (({ for: _for, ...value }) => value)(withoutIdentity(assertion) as WithoutIdentity<Extract<StructuralAssertion, { kind: 'provenance' }>>)
      : withoutIdentity(assertion)
    const candidates = actual.facts.filter((fact) => fact.factPath === expectedPath && fact.kind === assertion.kind)
    const match = candidates.find((fact) => equal(nativeFactValue(fact), expectedValue))
    results.push(result(assertion.id, assertion.role, match !== undefined, { factPath: expectedPath, value: expectedValue }, match ?? candidates[0]))
  }
  return completedResult(expected.fixtureId, actual.outcome, results, actual.facts.length > 0)
}

/** Extract a stable fact inventory without consulting an expected manifest. */
export function extractParserNativeFacts(document: IngestedDocument): readonly ParserNativeFact[] {
  const facts: ParserNativeFact[] = []
  const add = (factPath: string, fact: ParserNativeFactValue) => facts.push({ ...fact, factPath } as ParserNativeFact)
  const provenance = (factPath: string, target: { readonly coordinate: SourceCoordinate; readonly producer: DocumentProducer }) =>
    add(factPath, { kind: 'provenance', path: factPath, coordinate: target.coordinate, producer: target.producer })

  add('document', { kind: 'ordered-text', text: orderedText(document) })
  add('document', { kind: 'notes', text: noteText(document) })
  add('document', { kind: 'asset-count', count: document.assets.length })
  add('document', { kind: 'coordinate-kinds', kinds: coordinateKinds(document) })
  add('document', { kind: 'slide-order', slides: document.blocks.filter(isSlide).map((slide) => slide.slide) })
  add('document', { kind: 'sheet-order', sheets: document.blocks.filter(isSheet).sort((a, b) => a.index - b.index).map((sheet) => sheet.sheet) })
  add('document', { kind: 'page-order', pages: document.blocks.filter(isPage).map((page) => page.page) })
  add('document', document.diagnostics.some((item) => item.code === 'parser-downgrade')
    ? { kind: 'parser-downgrade', from: String(document.diagnostics.find((item) => item.code === 'parser-downgrade')?.from), to: String(document.diagnostics.find((item) => item.code === 'parser-downgrade')?.to) }
    : { kind: 'no-parser-downgrade' })
  for (const [key, value] of Object.entries(document.metadata)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') add('document', { kind: 'metadata', key, value })
  }
  provenance('document', { coordinate: { kind: 'document', documentSha256: document.source.documentSha256 }, producer: document.producer })
  document.blocks.forEach((block, index) => visitNativeBlock(block, `blocks/${index + 1}`, add, provenance))
  document.assets.forEach((asset, index) => {
    add(`assets/${index + 1}`, { kind: 'asset-count', count: document.assets.length })
    provenance(`assets/${index + 1}`, asset)
  })
  return facts
}

function visitNativeBlock(
  block: DocumentBlock | TextBlock | ListBlock | TableBlock,
  path: string,
  add: (path: string, fact: ParserNativeFactValue) => void,
  provenance: (path: string, target: { readonly coordinate: SourceCoordinate; readonly producer: DocumentProducer }) => void,
): void {
  provenance(path, block)
  if (block.kind === 'text') {
    if (block.role === 'heading' && block.level !== undefined) add(path, { kind: 'heading', level: block.level, text: block.text })
    if (block.role === 'note') add(path, { kind: 'notes', text: [block.text] })
    if (block.coordinate.kind === 'page-block') add(path, { kind: 'page-block', page: block.coordinate.page, block: block.coordinate.block, text: block.text })
    block.inlines.filter((inline) => inline.kind === 'link').forEach((inline) => add(path, { kind: 'link', text: inline.text, target: inline.target }))
    return
  }
  if (block.kind === 'list') {
    add(path, { kind: 'list', ordered: block.ordered, depth: listDepth(path), text: textBlocks(block.items.flatMap((item) => item.blocks)).map((item) => item.text) })
    block.items.forEach((item, itemIndex) => item.blocks.forEach((child, childIndex) => visitNativeBlock(child, `${path}/items/${itemIndex + 1}/blocks/${childIndex + 1}`, add, provenance)))
    return
  }
  if (block.kind === 'table') {
    add(path, { kind: 'table', ...tableValue(block) })
    if (block.coordinate.kind === 'logical-table') {
      add(path, { kind: 'csv-matrix', matrix: tableValue(block).rows })
      add(path, { kind: 'logical-row-bounds', start: block.coordinate.rowStart, end: block.coordinate.rowEnd })
    }
    block.rows.forEach((row, rowIndex) => row.forEach((cell, cellIndex) => {
      const cellPath = `${path}/rows/${rowIndex + 1}/cells/${cellIndex + 1}`
      provenance(cellPath, cell)
      if (cell.coordinate.kind === 'sheet-range') add(cellPath, { kind: 'cell', sheet: cell.coordinate.sheet, address: cell.coordinate.range, displayedValue: cell.displayedValue ?? '', ...(cell.formula ? { formula: cell.formula } : {}), ...(cell.mergeRange ? { mergeRange: cell.mergeRange } : {}) })
    }))
    return
  }
  if (block.kind === 'sheet') add(path, { kind: 'sheet-range', sheet: block.sheet, range: block.range })
  if (block.kind === 'slide') add(path, { kind: 'slide-boundary', slide: block.slide, text: textBlocks(block.blocks).map((item) => item.text) })
  if (block.kind === 'page') add(path, { kind: 'page-content-hash', page: block.page, sha256: createHash('sha256').update(JSON.stringify(block.blocks)).digest('hex') })
  block.blocks.forEach((child, index) => visitNativeBlock(child, `${path}/blocks/${index + 1}`, add, provenance))
  if (block.kind === 'slide') block.notes.forEach((note, index) => {
    add(`${path}/notes/${index + 1}`, { kind: 'slide-note', slide: block.slide, text: note.text })
    add(`${path}/notes/${index + 1}`, { kind: 'notes', text: [note.text] })
    provenance(`${path}/notes/${index + 1}`, note)
  })
}

/** Assert the same facts after Core's schema-2 projection. */
export function assertCoreProjectionFacts(expected: ExpectedFactManifest, document: IngestedDocument, outcome: EvaluationOutcome = { kind: 'success' }): StructuralAssertionResult {
  return assertStructuralFacts(expected, document, outcome)
}

function assertStructuralFacts(expected: ExpectedFactManifest, document: IngestedDocument | undefined, outcome: EvaluationOutcome): StructuralAssertionResult {
  const results = [outcomeResult(expected.expectedOutcome, outcome)]
  if (document && outcome.kind === 'success') {
    for (const assertion of expected.assertions) {
      results.push(assertFact(assertion, document))
    }
  } else if (expected.assertions.length > 0) {
    for (const assertion of expected.assertions) {
      results.push(failed(assertion.id, assertion.role, assertion, { reason: 'schema-2-document-unavailable' }))
    }
  }

  return completedResult(expected.fixtureId, outcome, results, document !== undefined)
}

/** Reports required facts that passed natively but were lost by the Core projection. */
export function compareProjectionFacts(native: StructuralAssertionResult, core: StructuralAssertionResult): readonly { readonly id: string; readonly role: AssertionRole }[] {
  const coreById = new Map(core.assertions.map((assertion) => [assertion.id, assertion]))
  return native.assertions
    .filter((assertion) => assertion.id !== 'outcome' && assertion.id !== 'native-fact-ids' && assertion.passed && !coreById.get(assertion.id)?.passed)
    .map((assertion) => ({ id: assertion.id, role: assertion.role }))
}

function completedResult(fixtureId: string, outcome: EvaluationOutcome, results: readonly AssertionResult[], hasFacts: boolean): StructuralAssertionResult {
  const required = results.filter((result) => result.id !== 'outcome' && result.role === 'required')
  const hasRequiredFacts = required.length > 0
  const passed = results.every((result) => result.passed || result.role === 'informational')
    && (outcome.kind !== 'success' || (hasFacts && hasRequiredFacts))
  return { fixtureId, passed, admitted: outcome.kind === 'success' && passed, assertions: results }
}

function outcomeResult(expected: EvaluationOutcome, actual: EvaluationOutcome): AssertionResult {
  return result('outcome', 'required', equal(expected, actual), expected, actual)
}

function assertFact(assertion: StructuralAssertion, document: IngestedDocument): AssertionResult {
  if (assertion.kind === 'provenance') {
    return provenanceResult(assertion, document)
  }

  const target = resolveFactPath(document, assertion.factPath)
  switch (assertion.kind) {
    case 'ordered-text': return compare(assertion, target === document ? orderedText(document) : undefined, assertion.text)
    case 'heading': return compare(assertion, isTargetKind(target, 'text') && target.role === 'heading' && target.level === assertion.level && target.text === assertion.text, true)
    case 'list': return compare(assertion, isTargetKind(target, 'list') && listDepth(assertion.factPath) === assertion.depth && target.ordered === assertion.ordered && equal(textBlocks(target.items.flatMap((item) => item.blocks)).map((block) => block.text), assertion.text), true)
    case 'table': return compare(assertion, isTargetKind(target, 'table') ? tableValue(target) : undefined, { columns: assertion.columns, rows: assertion.rows })
    case 'link': return compare(assertion, isTargetKind(target, 'text') && target.inlines.some((inline) => inline.kind === 'link' && inline.text === assertion.text && inline.target === assertion.target), true)
    case 'notes': return compare(assertion, isTargetKind(target, 'text') ? [target.text] : target === document ? noteText(document) : undefined, assertion.text)
    case 'slide-note': return compare(assertion, isTargetKind(target, 'text') && target.role === 'note' ? target.text : undefined, assertion.text)
    case 'asset-count': return compare(assertion, target === document || (target && 'byteLength' in target) ? document.assets.length : undefined, assertion.count)
    case 'coordinate-kinds': return compare(assertion, target === document ? coordinateKinds(document) : undefined, assertion.kinds)
    case 'slide-order': return compare(assertion, target === document ? document.blocks.filter(isSlide).map((slide) => slide.slide) : undefined, assertion.slides)
    case 'slide-boundary': return compare(assertion, isTargetKind(target, 'slide') && target.slide === assertion.slide ? textBlocks(target.blocks).map((block) => block.text) : undefined, assertion.text)
    case 'sheet-order': return compare(assertion, target === document ? document.blocks.filter(isSheet).sort((a, b) => a.index - b.index).map((sheet) => sheet.sheet) : undefined, assertion.sheets)
    case 'sheet-range': return compare(assertion, isTargetKind(target, 'sheet') && target.sheet === assertion.sheet ? target.range : undefined, assertion.range)
    case 'cell': return cellTargetResult(assertion, target)
    case 'csv-matrix': return compare(assertion, isTargetKind(target, 'table') ? tableValue(target).rows : undefined, assertion.matrix)
    case 'logical-row-bounds': return logicalTargetBoundsResult(assertion, target)
    case 'page-order': return compare(assertion, target === document ? document.blocks.filter(isPage).map((page) => page.page) : undefined, assertion.pages)
    case 'page-block': return compare(assertion, isTargetKind(target, 'text') && target.coordinate.kind === 'page-block' && target.coordinate.page === assertion.page && target.coordinate.block === assertion.block ? target.text : undefined, assertion.text)
    case 'page-content-hash': return compare(assertion, isTargetKind(target, 'page') && target.page === assertion.page ? createHash('sha256').update(JSON.stringify(target.blocks)).digest('hex') : undefined, assertion.sha256)
    case 'metadata': return compare(assertion, target === document ? document.metadata[assertion.key] : undefined, assertion.value)
    case 'parser-downgrade': return compare(assertion, target === document && document.diagnostics.some((diagnostic) => diagnostic.code === 'parser-downgrade' && diagnostic.from === assertion.from && diagnostic.to === assertion.to), true)
    case 'no-parser-downgrade': return compare(assertion, target === document && document.diagnostics.some((diagnostic) => diagnostic.code === 'parser-downgrade'), false)
  }
}

type FactTarget = IngestedDocument | DocumentBlock | TextBlock | ListBlock | TableBlock | TableBlock['rows'][number][number] | IngestedDocument['assets'][number]

function isTargetKind<Kind extends DocumentBlock['kind']>(target: FactTarget | undefined, kind: Kind): target is Extract<DocumentBlock, { kind: Kind }> {
  return target !== undefined && 'kind' in target && target.kind === kind
}

function resolveFactPath(document: IngestedDocument, path: string): FactTarget | undefined {
  if (path === 'document') {
    return document
  }
  if (/^assets\/\d+$/.test(path)) {
    return document.assets[Number(path.slice('assets/'.length)) - 1]
  }

  const segments = path.split('/')
  if (segments[0] !== 'blocks') {
    return undefined
  }
  let target: FactTarget | undefined = document.blocks[Number(segments[1]) - 1]
  for (let index = 2; target && index < segments.length; index += 2) {
    const collection = segments[index]
    const ordinal = Number(segments[index + 1]) - 1
    if (collection === 'blocks' && 'blocks' in target) {
      target = target.blocks[ordinal]
    } else if (collection === 'notes' && isTargetKind(target, 'slide')) {
      target = target.notes[ordinal]
    } else if (collection === 'items' && isTargetKind(target, 'list')) {
      const item: ListItem | undefined = target.items[ordinal]
      const blockCollection = segments[index + 2]
      const blockOrdinal = Number(segments[index + 3]) - 1
      if (blockCollection !== 'blocks') {
        return undefined
      }
      target = item?.blocks[blockOrdinal]
      index += 2
    } else if (collection === 'rows' && isTargetKind(target, 'table')) {
      const cellCollection = segments[index + 2]
      const cellOrdinal = Number(segments[index + 3]) - 1
      if (cellCollection !== 'cells') {
        return undefined
      }
      target = target.rows[ordinal]?.[cellOrdinal]
      index += 2
    } else {
      return undefined
    }
  }
  return target
}

function tableValue(table: TableBlock): { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] } {
  return { columns: table.columns, rows: table.rows.map((row) => row.map((cell) => cell.displayedValue ?? textBlocks(cell.blocks).map((block) => block.text).join(''))) }
}

function listDepth(path: string): number {
  return path.split('/').filter((segment) => segment === 'items').length + 1
}

function cellTargetResult(assertion: Extract<StructuralAssertion, { kind: 'cell' }>, target: FactTarget | undefined): AssertionResult {
  const cell = target && 'row' in target && 'column' in target ? target : undefined
  const actual = cell && coordinateAddress(cell.coordinate) === assertion.address && cell.coordinate.kind === 'sheet-range' && cell.coordinate.sheet === assertion.sheet
    ? { displayedValue: cell.displayedValue ?? '', ...(cell.formula ? { formula: cell.formula } : {}), ...(cell.mergeRange ? { mergeRange: cell.mergeRange } : {}) }
    : undefined
  const expected = { displayedValue: assertion.displayedValue, ...(assertion.formula ? { formula: assertion.formula } : {}), ...(assertion.mergeRange ? { mergeRange: assertion.mergeRange } : {}) }
  return result(assertion.id, assertion.role, equal(actual, expected), expected, actual)
}

function logicalTargetBoundsResult(assertion: Extract<StructuralAssertion, { kind: 'logical-row-bounds' }>, target: FactTarget | undefined): AssertionResult {
  const coordinate = isTargetKind(target, 'table') ? target.coordinate : undefined
  const actual = coordinate?.kind === 'logical-table' ? { start: coordinate.rowStart, end: coordinate.rowEnd } : undefined
  return result(assertion.id, assertion.role, equal(actual, { start: assertion.start, end: assertion.end }), { start: assertion.start, end: assertion.end }, actual)
}

function provenanceResult(assertion: Extract<StructuralAssertion, { kind: 'provenance' }>, document: IngestedDocument): AssertionResult {
  const actual = coreProvenance(document, assertion.path)
  const expected = { coordinate: assertion.coordinate, producer: assertion.producer }
  return result(assertion.id, assertion.role, equal(actual, expected), expected, actual)
}

/** Stable projection paths make provenance assertions independent of generated schema IDs. */
function coreProvenance(document: IngestedDocument, path: string): { readonly coordinate: SourceCoordinate; readonly producer: DocumentProducer } | undefined {
  const target = resolveFactPath(document, path)
  if (target === document) {
    return { coordinate: { kind: 'document', documentSha256: document.source.documentSha256 }, producer: document.producer }
  }
  return target && 'coordinate' in target ? { coordinate: target.coordinate, producer: target.producer } : undefined
}

function orderedText(document: IngestedDocument): readonly string[] {
  return textBlocks(document.blocks).filter((block) => block.role !== 'note').map((block) => block.text)
}

function noteText(document: IngestedDocument): readonly string[] {
  return [
    ...textBlocks(document.blocks).filter((block) => block.role === 'note').map((block) => block.text),
    ...document.blocks.filter(isSlide).flatMap((slide) => slide.notes.map((note) => note.text)),
  ]
}

/** Hashes the complete normalized block payload, including exact block coordinates and explicit empty pages. */
export function pageContentHash(document: IngestedDocument, page: number): string | undefined {
  const value = document.blocks.filter(isPage).find((item) => item.page === page)
  return value ? createHash('sha256').update(JSON.stringify(value.blocks)).digest('hex') : undefined
}

function coordinateKinds(document: IngestedDocument): readonly SourceCoordinate['kind'][] {
  const coordinates = [
    ...document.blocks.flatMap(blockCoordinates),
    ...document.assets.map((asset) => asset.coordinate),
  ]
  return [...new Set(coordinates.map((coordinate) => coordinate.kind))].sort()
}

function blockCoordinates(block: DocumentBlock): SourceCoordinate[] {
  const nested = block.kind === 'text' ? []
    : block.kind === 'list' ? block.items.flatMap((item) => item.blocks.flatMap((child) => childCoordinates(child)))
      : block.kind === 'table' ? block.rows.flatMap((row) => row.flatMap((cell) => [cell.coordinate, ...cell.blocks.flatMap(childCoordinates)]))
        : block.blocks.flatMap(childCoordinates)
  return [block.coordinate, ...nested]
}

function childCoordinates(block: TextBlock | ListBlock | TableBlock): SourceCoordinate[] {
  return blockCoordinates(block as DocumentBlock)
}

function textBlocks(blocks: readonly (DocumentBlock | TextBlock | ListBlock | TableBlock)[]): TextBlock[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'text') return [block]
    if (block.kind === 'list') return block.items.flatMap((item) => textBlocks(item.blocks))
    if (block.kind === 'table') return block.rows.flatMap((row) => row.flatMap((cell) => textBlocks(cell.blocks)))
    return textBlocks(block.blocks)
  })
}

function isSlide(block: DocumentBlock): block is Extract<DocumentBlock, { kind: 'slide' }> { return block.kind === 'slide' }
function isSheet(block: DocumentBlock): block is Extract<DocumentBlock, { kind: 'sheet' }> { return block.kind === 'sheet' }
function isPage(block: DocumentBlock): block is Extract<DocumentBlock, { kind: 'page' }> { return block.kind === 'page' }
function coordinateAddress(coordinate: SourceCoordinate): string | undefined { return coordinate.kind === 'sheet-range' ? coordinate.range : undefined }

function compare(assertion: StructuralAssertion, actual: unknown, expected: unknown): AssertionResult {
  return result(assertion.id, assertion.role, equal(actual, expected), expected, actual)
}

function failed(id: string, role: AssertionRole, expected: unknown, actual: unknown): AssertionResult { return result(id, role, false, expected, actual) }
function result(id: string, role: AssertionRole, passed: boolean, expected: unknown, actual: unknown): AssertionResult { return { id, role, passed, expected: bounded(expected), actual: bounded(actual) } }
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)) }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
  return value
}
function withoutIdentity(assertion: StructuralAssertion): WithoutIdentity<StructuralAssertion> {
  const { id: _id, role: _role, ...fact } = assertion
  if ('factPath' in fact) {
    const { factPath: _path, ...value } = fact
    return value as WithoutIdentity<StructuralAssertion>
  }
  return fact as WithoutIdentity<StructuralAssertion>
}
function nativeFactValue(fact: ParserNativeFact): WithoutIdentity<StructuralAssertion> { const { factPath: _path, ...value } = fact; return value as WithoutIdentity<StructuralAssertion> }
type WithoutIdentity<T> = T extends unknown ? Omit<T, 'id' | 'role' | 'factPath'> : never

const MAX_EVIDENCE_DEPTH = 3
const MAX_EVIDENCE_ITEMS = 20
const MAX_EVIDENCE_STRING_BYTES = 240

/** Canonical, deeply bounded evidence safe to retain in deterministic eval output. */
function bounded(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return boundedString(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'undefined') return { truncated: true, reason: 'undefined' }
  if (typeof value === 'function' || typeof value === 'symbol') return { truncated: true, reason: typeof value }
  if (depth >= MAX_EVIDENCE_DEPTH) return { truncated: true, reason: 'depth' }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_EVIDENCE_ITEMS).map((item) => bounded(item, depth + 1))
    return value.length > MAX_EVIDENCE_ITEMS
      ? [...items, { truncated: true, omitted: value.length - MAX_EVIDENCE_ITEMS }]
      : items
  }
  if (!isPlainRecord(value)) return { truncated: true, reason: 'non-plain-object' }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  const boundedEntries = entries.slice(0, MAX_EVIDENCE_ITEMS).map(([key, item]) => [key, bounded(item, depth + 1)] as const)
  if (entries.length > MAX_EVIDENCE_ITEMS) boundedEntries.push(['$truncated', { truncated: true, omitted: entries.length - MAX_EVIDENCE_ITEMS }])
  return Object.fromEntries(boundedEntries)
}

function boundedString(value: string): string | { readonly truncated: true; readonly omittedBytes: number; readonly value: string } {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= MAX_EVIDENCE_STRING_BYTES) return value
  const prefix = new TextDecoder().decode(bytes.slice(0, MAX_EVIDENCE_STRING_BYTES))
  return { truncated: true, omittedBytes: bytes.byteLength - new TextEncoder().encode(prefix).byteLength, value: prefix }
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
