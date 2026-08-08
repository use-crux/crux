import type { DocumentBlock, IngestedDocument, ListBlock, SourceCoordinate, TableBlock, TextBlock } from '@use-crux/core/indexing'

export type AssertionRole = 'required' | 'informational'

export type EvaluationOutcome =
  | { readonly kind: 'success'; readonly diagnostic?: 'external-resource-blocked' }
  | { readonly kind: 'failure'; readonly error: string }
  | { readonly kind: 'missing'; readonly reason?: string }

export type StructuralAssertion =
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
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'metadata'; readonly key: string; readonly value: string | number | boolean }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'parser-downgrade'; readonly from: string; readonly to: string }
  | { readonly id: string; readonly role: AssertionRole; readonly kind: 'no-parser-downgrade' }

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
export type ParserNativeFact = WithoutIdentity<StructuralAssertion> & {
  /** Exactly one native fact must identify each expected assertion. */
  readonly assertionId: string
  /** Parser-owned structural location, retained for duplicate-kind disambiguation. */
  readonly path: string
}

export interface ParserNativeFacts {
  readonly outcome: EvaluationOutcome
  readonly facts: readonly ParserNativeFact[]
}

/** Assert a parser's native typed fact surface before its Core projection exists. */
export function assertParserNativeFacts(expected: ExpectedFactManifest, actual: ParserNativeFacts): StructuralAssertionResult {
  const expectedIds = expected.assertions.map((assertion) => assertion.id)
  const uniqueIds = new Set(actual.facts.map((fact) => fact.assertionId))
  const completeIdSet = uniqueIds.size === actual.facts.length
    && actual.facts.length === expectedIds.length
    && expectedIds.every((id) => uniqueIds.has(id))
  const results = [outcomeResult(expected.expectedOutcome, actual.outcome), result('native-fact-ids', 'required', completeIdSet, expectedIds, actual.facts.map((fact) => ({ assertionId: fact.assertionId, path: fact.path })))]
  for (const assertion of expected.assertions) {
    const matches = actual.facts.filter((fact) => fact.assertionId === assertion.id)
    const native = matches[0]
    results.push(result(assertion.id, assertion.role, matches.length === 1 && native !== undefined && equal(nativeFactValue(native), withoutIdentity(assertion)), withoutIdentity(assertion), native))
  }
  return completedResult(expected.fixtureId, actual.outcome, results, actual.facts.length > 0)
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
  switch (assertion.kind) {
    case 'ordered-text': return compare(assertion, orderedText(document), assertion.text)
    case 'heading': return compare(assertion, headings(document).some((heading) => heading.level === assertion.level && heading.text === assertion.text), true)
    case 'list': return compare(assertion, lists(document).some((list) => list.ordered === assertion.ordered && list.depth === assertion.depth && equal(list.text, assertion.text)), true)
    case 'table': return compare(assertion, tables(document).some((table) => equal(table.columns, assertion.columns) && equal(table.rows, assertion.rows)), true)
    case 'link': return compare(assertion, links(document).some((link) => link.text === assertion.text && link.target === assertion.target), true)
    case 'notes': return compare(assertion, noteText(document), assertion.text)
    case 'slide-note': return compare(assertion, document.blocks.filter(isSlide).find((slide) => slide.slide === assertion.slide)?.notes.map((note) => note.text), [assertion.text])
    case 'asset-count': return compare(assertion, document.assets.length, assertion.count)
    case 'coordinate-kinds': return compare(assertion, coordinateKinds(document), assertion.kinds)
    case 'slide-order': return compare(assertion, document.blocks.filter(isSlide).map((slide) => slide.slide), assertion.slides)
    case 'slide-boundary': return compare(assertion, slideText(document, assertion.slide), assertion.text)
    case 'sheet-order': return compare(assertion, document.blocks.filter(isSheet).sort((a, b) => a.index - b.index).map((sheet) => sheet.sheet), assertion.sheets)
    case 'sheet-range': return compare(assertion, document.blocks.filter(isSheet).find((sheet) => sheet.sheet === assertion.sheet)?.range, assertion.range)
    case 'cell': return cellResult(assertion, document)
    case 'csv-matrix': return compare(assertion, csvMatrix(document), assertion.matrix)
    case 'logical-row-bounds': return logicalBoundsResult(assertion, document)
    case 'page-order': return compare(assertion, document.blocks.filter(isPage).map((page) => page.page), assertion.pages)
    case 'page-block': return compare(assertion, pageBlockText(document, assertion.page, assertion.block), assertion.text)
    case 'metadata': return compare(assertion, document.metadata[assertion.key], assertion.value)
    case 'parser-downgrade': return compare(assertion, document.diagnostics.some((diagnostic) => diagnostic.code === 'parser-downgrade' && diagnostic.from === assertion.from && diagnostic.to === assertion.to), true)
    case 'no-parser-downgrade': return compare(assertion, document.diagnostics.some((diagnostic) => diagnostic.code === 'parser-downgrade'), false)
  }
}

function cellResult(assertion: Extract<StructuralAssertion, { kind: 'cell' }>, document: IngestedDocument): AssertionResult {
  const cell = document.blocks.filter(isSheet).find((sheet) => sheet.sheet === assertion.sheet)?.blocks.flatMap((table) => table.rows.flat()).find((candidate) => coordinateAddress(candidate.coordinate) === assertion.address)
  const actual = cell && { displayedValue: cell.displayedValue ?? '', ...(cell.formula ? { formula: cell.formula } : {}), ...(cell.mergeRange ? { mergeRange: cell.mergeRange } : {}) }
  const expected = { displayedValue: assertion.displayedValue, ...(assertion.formula ? { formula: assertion.formula } : {}), ...(assertion.mergeRange ? { mergeRange: assertion.mergeRange } : {}) }
  return result(assertion.id, assertion.role, equal(actual, expected), expected, actual)
}

function logicalBoundsResult(assertion: Extract<StructuralAssertion, { kind: 'logical-row-bounds' }>, document: IngestedDocument): AssertionResult {
  const coordinate = document.blocks.find((block) => block.kind === 'table')?.coordinate
  const actual = coordinate?.kind === 'logical-table' ? { start: coordinate.rowStart, end: coordinate.rowEnd } : undefined
  return result(assertion.id, assertion.role, equal(actual, { start: assertion.start, end: assertion.end }), { start: assertion.start, end: assertion.end }, actual)
}

function orderedText(document: IngestedDocument): readonly string[] {
  return textBlocks(document.blocks).map((block) => block.text)
}

function headings(document: IngestedDocument): readonly { readonly level: number | undefined; readonly text: string }[] {
  return textBlocks(document.blocks).filter((block) => block.role === 'heading').map((block) => ({ level: block.level, text: block.text }))
}

function noteText(document: IngestedDocument): readonly string[] {
  return [
    ...textBlocks(document.blocks).filter((block) => block.role === 'note').map((block) => block.text),
    ...document.blocks.filter(isSlide).flatMap((slide) => slide.notes.map((note) => note.text)),
  ]
}

function lists(document: IngestedDocument): readonly { readonly ordered: boolean; readonly depth: number; readonly text: readonly string[] }[] {
  return listBlocks(document.blocks).map(({ list, depth }) => ({ ordered: list.ordered, depth, text: textBlocks(list.items.flatMap((item) => item.blocks)).map((block) => block.text) }))
}

function tables(document: IngestedDocument): readonly { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }[] {
  return tableBlocks(document.blocks).map((table) => ({ columns: table.columns, rows: table.rows.map((row) => row.map((cell) => cell.displayedValue ?? textBlocks(cell.blocks).map((block) => block.text).join(''))) }))
}

function links(document: IngestedDocument): readonly { readonly text: string; readonly target: string }[] {
  return textBlocks(document.blocks).flatMap((block) => block.inlines.filter((inline) => inline.kind === 'link').map((inline) => ({ text: inline.text, target: inline.target })))
}

function csvMatrix(document: IngestedDocument): readonly (readonly string[])[] | undefined {
  const table = document.blocks.find((block) => block.kind === 'table')
  return table ? table.rows.map((row) => row.map((cell) => cell.displayedValue ?? textBlocks(cell.blocks).map((block) => block.text).join(''))) : undefined
}

function pageBlockText(document: IngestedDocument, page: number, block: number): string | undefined {
  const candidate = document.blocks.filter(isPage).find((item) => item.page === page)?.blocks[block - 1]
  return candidate?.kind === 'text' ? candidate.text : undefined
}

function slideText(document: IngestedDocument, slide: number): readonly string[] | undefined {
  const candidate = document.blocks.filter(isSlide).find((item) => item.slide === slide)
  return candidate ? textBlocks(candidate.blocks).map((block) => block.text) : undefined
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

function tableBlocks(blocks: readonly DocumentBlock[]): TableBlock[] {
  return blocks.flatMap((block) => block.kind === 'table' ? [block] : block.kind === 'page' || block.kind === 'slide' || block.kind === 'sheet' ? tableBlocks(block.blocks as DocumentBlock[]) : [])
}

function listBlocks(blocks: readonly (DocumentBlock | TextBlock | ListBlock | TableBlock)[], depth = 1): { list: ListBlock; depth: number }[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'list') return [{ list: block, depth }, ...block.items.flatMap((item) => listBlocks(item.blocks, depth + 1))]
    if (block.kind === 'table') return block.rows.flatMap((row) => row.flatMap((cell) => listBlocks(cell.blocks, depth)))
    if (block.kind === 'page' || block.kind === 'slide' || block.kind === 'sheet') return listBlocks(block.blocks as DocumentBlock[], depth)
    return []
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
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function withoutIdentity(assertion: StructuralAssertion): WithoutIdentity<StructuralAssertion> { const { id: _id, role: _role, ...fact } = assertion; return fact as WithoutIdentity<StructuralAssertion> }
function nativeFactValue(fact: ParserNativeFact): WithoutIdentity<StructuralAssertion> { const { assertionId: _id, path: _path, ...value } = fact; return value as WithoutIdentity<StructuralAssertion> }
type WithoutIdentity<T> = T extends unknown ? Omit<T, 'id' | 'role'> : never

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
