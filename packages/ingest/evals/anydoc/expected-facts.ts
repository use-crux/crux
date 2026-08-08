import type { AnydocFixtureManifest, RequiredFact } from './fixture-manifest'
import type { ExpectedFactManifest, StructuralAssertion } from './structural-assertions'
import type { ParserIdentity, SourceCoordinate } from '@use-crux/core/indexing'

const anydocProducer: ParserIdentity = { kind: 'parser', name: 'anydoc', version: 'eval', adapterVersion: '2' }
const csvProducer: ParserIdentity = { kind: 'parser', name: 'csv-parse', version: '6.2.1', adapterVersion: '2' }
const excelProducer: ParserIdentity = { kind: 'parser', name: 'exceljs', version: '4.4.0', adapterVersion: '2' }
const pdfProducer: ParserIdentity = { kind: 'parser', name: 'pdf-inspector', version: '1.12.0', adapterVersion: '2' }

function proseAssertions(options: { readonly notes?: readonly string[]; readonly assetCount?: number; readonly hash: string } ): readonly StructuralAssertion[] {
  const documentCoordinate = { kind: 'document', documentSha256: options.hash } as const
  return [
    ...fact({ id: 'prose-text', role: 'required', kind: 'ordered-text', text: ['Release Notes', 'Structured ingestion reference.', 'First', 'Nested', 'Plan', 'Status', 'Pro', 'Ready'] }, 'document', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-heading', role: 'required', kind: 'heading', level: 1, text: 'Release Notes' }, 'blocks/1', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-list', role: 'required', kind: 'list', ordered: false, depth: 1, text: ['First', 'Nested'] }, 'blocks/3', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-nested-list', role: 'required', kind: 'list', ordered: false, depth: 2, text: ['Nested'] }, 'blocks/3/items/1/blocks/2', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-table', role: 'required', kind: 'table', columns: ['Plan', 'Status'], rows: [['Plan', 'Status'], ['Pro', 'Ready']] }, 'blocks/4', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-link', role: 'required', kind: 'link', text: 'reference', target: 'https://cruxjs.dev' }, 'blocks/2', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-notes', role: 'required', kind: 'notes', text: options.notes ?? [] }, options.notes?.length ? 'blocks/5' : 'document', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-assets', role: 'required', kind: 'asset-count', count: options.assetCount ?? 0 }, options.assetCount ? 'assets/1' : 'document', documentCoordinate, anydocProducer),
    ...fact({ id: 'prose-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['document'] }, 'document', documentCoordinate, anydocProducer),
  ]
}

const COVERAGE: Readonly<Record<RequiredFact, readonly StructuralAssertion['kind'][]>> = {
  'all-text-in-order': ['ordered-text'], assets: ['asset-count'], columns: ['table'], coordinates: ['provenance'],
  'deterministic-diagnostics': ['no-parser-downgrade', 'parser-downgrade'], 'formulas-and-merges': ['cell'], 'heading-levels': ['heading'],
  'link-targets': ['link'], 'list-nesting': ['list'], 'logical-matrix': ['csv-matrix'], 'notes-and-assets': ['notes', 'asset-count'],
  'occupied-ranges': ['sheet-range'], 'page-block-coordinates': ['provenance'], 'page-content': ['page-content-hash'], 'page-count-and-order': ['page-order'],
  'page-metadata': ['metadata'], 'row-bounds': ['logical-row-bounds'], 'sheet-identity-and-order': ['sheet-order'],
  'slide-boundaries': ['slide-boundary'], 'slide-identity-and-order': ['slide-order'], 'slide-note-ownership': ['slide-note'], 'table-grid': ['table'],
}

/**
 * Corpus facts are deliberately typed schema-2 expectations, never rendered
 * Markdown snapshots. Every fixture, including unavailable cases, has one.
 */
export const expectedFactsByFixture: Readonly<Record<string, ExpectedFactManifest>> = {
  'docx-structure-v1': success('docx-structure-v1', [
    ...proseAssertions({ hash: '5766439b78597e77a28ebf41562ed2375edff1cf6de84eea22590ab73ce1a9fd', notes: ['Crux footnote evidence.'], assetCount: 1 }),
  ]),
  'doc-legacy-v1': success('doc-legacy-v1', proseAssertions({ hash: '43d7f00b1bd7d0784b20245176327690137891a6e65577ca0f2e2dbb3ab9b1c1' })),
  'docm-macro-v1': missing('docm-macro-v1'),
  'rtf-prose-v1': success('rtf-prose-v1', proseAssertions({ hash: '1be57882b7e295a39e752d865ae228315d804c165d8eead8e6f6e0b2ca9596d3' })),
  'odt-prose-v1': success('odt-prose-v1', proseAssertions({ hash: '96446747eee321ec556b3cb3633d24158014c455d0e0a05bb1a6e24b0a19482b' })),
  'epub-prose-v1': success('epub-prose-v1', proseAssertions({ hash: '2a53090553242888578e45e11472ff6010ef508afc9c2edce4003a35ffda7fab' })),
  'pptx-structure-v1': success('pptx-structure-v1', [
    ...fact({ id: 'slides', role: 'required', kind: 'slide-order', slides: [1, 2] }, 'document', { kind: 'document', documentSha256: 'a41f60064fc760ee95fa78d0217a672f504f3d12a6da7435775e7666c497f80e' }, anydocProducer),
    ...fact({ id: 'slide-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['slide'] }, 'document', { kind: 'document', documentSha256: 'a41f60064fc760ee95fa78d0217a672f504f3d12a6da7435775e7666c497f80e' }, anydocProducer),
    ...fact({ id: 'slide-1-boundary', role: 'required', kind: 'slide-boundary', slide: 1, text: ['Slide One', 'Plan', 'Status', 'Pro', 'Ready'] }, 'blocks/1', { kind: 'slide', slide: 1 }, anydocProducer),
    ...fact({ id: 'slide-2-boundary', role: 'required', kind: 'slide-boundary', slide: 2, text: ['Slide Two'] }, 'blocks/2', { kind: 'slide', slide: 2 }, anydocProducer),
    ...fact({ id: 'slide-text', role: 'required', kind: 'ordered-text', text: ['Slide One', 'Plan', 'Status', 'Pro', 'Ready', 'Slide Two'] }, 'document', { kind: 'document', documentSha256: 'a41f60064fc760ee95fa78d0217a672f504f3d12a6da7435775e7666c497f80e' }, anydocProducer),
    ...fact({ id: 'slide-table', role: 'required', kind: 'table', columns: ['Plan', 'Status'], rows: [['Plan', 'Status'], ['Pro', 'Ready']] }, 'blocks/1/blocks/2', { kind: 'slide', slide: 1 }, anydocProducer),
    ...fact({ id: 'slide-1-note', role: 'required', kind: 'slide-note', slide: 1, text: 'Owner note for slide one.' }, 'blocks/1/notes/1', { kind: 'slide', slide: 1 }, anydocProducer),
    ...fact({ id: 'slide-2-note', role: 'required', kind: 'slide-note', slide: 2, text: 'Owner note for slide two.' }, 'blocks/2/notes/1', { kind: 'slide', slide: 2 }, anydocProducer),
    ...fact({ id: 'slide-assets', role: 'required', kind: 'asset-count', count: 1 }, 'assets/1', { kind: 'slide', slide: 2 }, anydocProducer),
  ]),
  'ppt-legacy-v1': missing('ppt-legacy-v1'),
  'xls-spreadsheet-v1': spreadsheet('xls-spreadsheet-v1', true),
  'ods-spreadsheet-v1': spreadsheet('ods-spreadsheet-v1', true),
  'csv-control-v1': success('csv-control-v1', [
    ...fact({ id: 'csv-matrix', role: 'required', kind: 'csv-matrix', matrix: [['Plan', 'Price', 'Notes'], ['Pro', '20', 'best, value'], ['Free', '', '']] }, 'blocks/1', { kind: 'logical-table', rowStart: 1, rowEnd: 3 }, csvProducer),
    ...fact({ id: 'csv-row-bounds', role: 'required', kind: 'logical-row-bounds', start: 1, end: 3 }, 'blocks/1', { kind: 'logical-table', rowStart: 1, rowEnd: 3 }, csvProducer),
    ...fact({ id: 'csv-table', role: 'required', kind: 'table', columns: ['Plan', 'Price', 'Notes'], rows: [['Plan', 'Price', 'Notes'], ['Pro', '20', 'best, value'], ['Free', '', '']] }, 'blocks/1', { kind: 'logical-table', rowStart: 1, rowEnd: 3 }, csvProducer),
    ...fact({ id: 'csv-diagnostics', role: 'required', kind: 'no-parser-downgrade' }, 'document', { kind: 'document', documentSha256: '416a2ff58e53cb4196bff8bbd9c67ec4253788f2e86fca317628b15e092b02e5' }, csvProducer),
  ]),
  'xlsx-control-v1': success('xlsx-control-v1', [
    ...fact({ id: 'xlsx-sheets', role: 'required', kind: 'sheet-order', sheets: ['Pricing'] }, 'document', { kind: 'document', documentSha256: '3eab7f712ee5bc6f00d044040afb79f0fe9d885e1cf47a7a1d89aa445b7a113c' }, excelProducer),
    ...fact({ id: 'xlsx-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['sheet-range'] }, 'document', { kind: 'document', documentSha256: '3eab7f712ee5bc6f00d044040afb79f0fe9d885e1cf47a7a1d89aa445b7a113c' }, excelProducer),
    ...fact({ id: 'xlsx-text', role: 'required', kind: 'ordered-text', text: ['Plan', 'Price', 'Pro', '20'] }, 'document', { kind: 'document', documentSha256: '3eab7f712ee5bc6f00d044040afb79f0fe9d885e1cf47a7a1d89aa445b7a113c' }, excelProducer),
    ...fact({ id: 'xlsx-range', role: 'required', kind: 'sheet-range', sheet: 'Pricing', range: 'A1:B2' }, 'blocks/1', { kind: 'sheet-range', sheet: 'Pricing', range: 'A1:B2' }, excelProducer),
    ...sheetCellFacts('xlsx-a1', 'blocks/1/blocks/1/rows/1/cells/1', 'Pricing', 'A1', 'Plan', excelProducer),
    ...sheetCellFacts('xlsx-b1', 'blocks/1/blocks/1/rows/1/cells/2', 'Pricing', 'B1', 'Price', excelProducer),
    ...sheetCellFacts('xlsx-a2', 'blocks/1/blocks/1/rows/2/cells/1', 'Pricing', 'A2', 'Pro', excelProducer),
    ...sheetCellFacts('xlsx-b2', 'blocks/1/blocks/1/rows/2/cells/2', 'Pricing', 'B2', '20', excelProducer),
  ]),
  'pdf-control-v1': success('pdf-control-v1', [
    ...fact({ id: 'pdf-pages', role: 'required', kind: 'page-order', pages: [1, 2, 3, 4, 5, 6, 7, 8] }, 'document', { kind: 'document', documentSha256: 'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924' }, pdfProducer),
    ...fact({ id: 'pdf-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['page', 'page-block'] }, 'document', { kind: 'document', documentSha256: 'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924' }, pdfProducer),
    ...fact({ id: 'pdf-title', role: 'required', kind: 'metadata', key: 'title', value: 'Firecrawl Documentation - API Reference' }, 'document', { kind: 'document', documentSha256: 'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924' }, pdfProducer),
    ...fact({ id: 'pdf-first-block', role: 'required', kind: 'page-block', page: 1, block: 1, text: '# Firecrawl API Documentation' }, 'blocks/1/blocks/1', { kind: 'page-block', page: 1, block: 1, start: 0, end: 29 }, pdfProducer),
    ...pdfPageFact(1, '7a024ee44003f09f5bce3202a4b0e34fd2317d71b9c7ab71328fa30c9783201c'),
    ...pdfPageFact(2, 'a7c92134f7a533ba743cd6185c3711f49aba00b288dce4af24ca32492d6d125c'),
    ...pdfPageFact(3, '87f483fbfa31397abb0ff03943aa3131d270b0789abc7598da46abe355a5a6ea'),
    ...pdfPageFact(4, 'fa3c17a449ee28cf01070dd3d8e5ee159cb616124b02f6c245f228bdfac01c74'),
    ...pdfPageFact(5, '72dc1ed3b91129a095e4d16fb5aea46fd21fb32e48f93c3f0fb5be866add9c0b'),
    ...pdfPageFact(6, 'fe44a2e589c2ed754e55bd070f47f52daa9acb89b3c1e2d3469c5f7ff48f3ca3'),
    ...pdfPageFact(7, '0ff7075883eef9b740278f7ac7ee4c85f1e6cbf913d336d8761582b633b73171'),
    ...pdfPageFact(8, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'),
    ...fact({ id: 'pdf-table', role: 'required', kind: 'table', columns: ['Parameter', 'Type', 'Default', 'Description'], rows: [
      ['Parameter', 'Type', 'Default', 'Description'],
      ['url', 'string', 'required', 'The URL to scrape'],
      ['formats', 'string[]', '["markdown"]', 'Output formats'],
      ['onlyMainContent', 'boolean', 'true', 'Primary content only'],
      ['includeTags', 'string[]', '[]', 'CSS selectors to include'],
      ['excludeTags', 'string[]', '[]', 'CSS selectors to exclude'],
      ['waitFor', 'integer', '0', 'Wait ms before capture'],
      ['timeout', 'integer', '30000', 'Max page load time ms'],
      ['mobile', 'boolean', 'false', 'Use mobile viewport'],
    ] }, 'blocks/1/blocks/13', { kind: 'page-block', page: 1, block: 13, start: 1517, end: 1944 }, pdfProducer),
    ...fact({ id: 'pdf-native-primary', role: 'required', kind: 'no-parser-downgrade' }, 'document', { kind: 'document', documentSha256: 'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924' }, pdfProducer),
  ]),
  'encrypted-v1': missing('encrypted-v1'),
  'truncated-v1': failure('truncated-v1', 'invalid-result'),
  'malformed-v1': failure('malformed-v1', 'invalid-result'),
  'mislabeled-v1': failure('mislabeled-v1', 'invalid-result'),
  'expansion-heavy-v1': failure('expansion-heavy-v1', 'expanded-too-large'),
  'external-link-v1': {
    ...success('external-link-v1', proseAssertions({ hash: 'edd3f32d7f4ac15858e566362604802a92bd5f73042c24c47e778c32a4e92574' })),
    expectedOutcome: { kind: 'success', diagnostic: 'external-resource-blocked' },
  },
  'timeout-v1': missing('timeout-v1'),
  'memory-limit-v1': missing('memory-limit-v1'),
  'containment-unavailable-v1': missing('containment-unavailable-v1'),
}

export function expectedFactsForFixture(fixture: AnydocFixtureManifest): ExpectedFactManifest {
  const facts = expectedFactsByFixture[fixture.id]
  if (!facts) {
    throw new Error(`Fixture "${fixture.id}" has no expected structural facts.`)
  }
  return facts
}

export function validateExpectedFacts(manifests: readonly AnydocFixtureManifest[], expectedFacts: Readonly<Record<string, ExpectedFactManifest>> = expectedFactsByFixture): string[] {
  const errors: string[] = []
  for (const fixture of manifests) {
    const expected = expectedFacts[fixture.id]
    if (!expected) {
      errors.push(`fixture "${fixture.id}" has no expected structural facts.`)
      continue
    }
    if (fixture.availability === 'missing' && expected.expectedOutcome.kind !== 'missing') {
      errors.push(`fixture "${fixture.id}" is unavailable but its expected facts could admit a parser.`)
    }
    if (fixture.expectedOutcome.kind === 'failure' && expected.expectedOutcome.kind !== 'failure') {
      errors.push(`fixture "${fixture.id}" must retain its typed hostile outcome.`)
    }
    if (fixture.expectedOutcome.kind !== 'success') {
      continue
    }
    const assertionKinds = new Set(expected.assertions.filter((assertion) => assertion.role === 'required').map((assertion) => assertion.kind))
    for (const requiredFact of fixture.requiredFacts) {
      const kinds = COVERAGE[requiredFact]
      if (!kinds.some((kind) => assertionKinds.has(kind))) {
        errors.push(`fixture "${fixture.id}" required fact "${requiredFact}" has no required structural assertion.`)
      }
    }
    const provenanceAssertions = expected.assertions.filter((assertion): assertion is Extract<StructuralAssertion, { kind: 'provenance' }> => assertion.kind === 'provenance')
    for (const assertion of expected.assertions) {
      if (assertion.role !== 'required' || assertion.kind === 'provenance') {
        continue
      }
      const links = provenanceAssertions.filter((candidate) => candidate.for === assertion.id)
      if (links.length !== 1) {
        errors.push(`fixture "${fixture.id}" required assertion "${assertion.id}" has no unique provenance assertion.`)
        continue
      }
      const link = links[0]!
      if (link.path !== assertion.factPath) {
        errors.push(`fixture "${fixture.id}" required assertion "${assertion.id}" fact path "${assertion.factPath}" does not match provenance path "${link.path}".`)
      }
      if (!coordinateClassMatches(assertion, link.coordinate)) {
        errors.push(`fixture "${fixture.id}" required assertion "${assertion.id}" has coordinate kind "${link.coordinate.kind}" incompatible with fact path "${assertion.factPath}".`)
      }
    }
  }
  return errors
}

function spreadsheet(fixtureId: string, hasMerge: boolean): ExpectedFactManifest {
  const hash = fixtureId === 'xls-spreadsheet-v1'
    ? '89716212ee3279cdbda34421da01242df7917e09a624f80f116181514faa6975'
    : '27a0636ae8b699921d9ce14e9f2df5e272c5648408a688804eacf0ba11c0152e'
  return success(fixtureId, [
    ...fact({ id: 'workbook-sheets', role: 'required', kind: 'sheet-order', sheets: ['Pricing', 'Regions'] }, 'document', { kind: 'document', documentSha256: hash }, anydocProducer),
    ...fact({ id: 'workbook-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['sheet-range'] }, 'document', { kind: 'document', documentSha256: hash }, anydocProducer),
    ...fact({ id: 'workbook-text', role: 'required', kind: 'ordered-text', text: ['Plan', 'Price', 'Taxed', 'Pro', '20', '24', 'Merged total', 'Region', 'EU'] }, 'document', { kind: 'document', documentSha256: hash }, anydocProducer),
    ...fact({ id: 'pricing-range', role: 'required', kind: 'sheet-range', sheet: 'Pricing', range: 'A1:C4' }, 'blocks/1', { kind: 'sheet-range', sheet: 'Pricing', range: 'A1:C4' }, anydocProducer),
    ...fact({ id: 'regions-range', role: 'required', kind: 'sheet-range', sheet: 'Regions', range: 'A1:A2' }, 'blocks/2', { kind: 'sheet-range', sheet: 'Regions', range: 'A1:A2' }, anydocProducer),
    ...sheetCellFacts('pricing-a1', 'blocks/1/blocks/1/rows/1/cells/1', 'Pricing', 'A1', 'Plan', anydocProducer),
    ...sheetCellFacts('pricing-b1', 'blocks/1/blocks/1/rows/1/cells/2', 'Pricing', 'B1', 'Price', anydocProducer),
    ...sheetCellFacts('pricing-c1', 'blocks/1/blocks/1/rows/1/cells/3', 'Pricing', 'C1', 'Taxed', anydocProducer),
    ...sheetCellFacts('pricing-a2', 'blocks/1/blocks/1/rows/2/cells/1', 'Pricing', 'A2', 'Pro', anydocProducer),
    ...sheetCellFacts('pricing-b2', 'blocks/1/blocks/1/rows/2/cells/2', 'Pricing', 'B2', '20', anydocProducer),
    ...sheetCellFacts('pricing-c2', 'blocks/1/blocks/1/rows/2/cells/3', 'Pricing', 'C2', '24', anydocProducer, { formula: 'B2*1.2' }),
    ...sheetCellFacts('pricing-c4', 'blocks/1/blocks/1/rows/3/cells/3', 'Pricing', 'C4', '', anydocProducer),
    ...sheetCellFacts('regions-a1', 'blocks/2/blocks/1/rows/1/cells/1', 'Regions', 'A1', 'Region', anydocProducer),
    ...sheetCellFacts('regions-a2', 'blocks/2/blocks/1/rows/2/cells/1', 'Regions', 'A2', 'EU', anydocProducer),
    ...(hasMerge ? [
      ...sheetCellFacts('pricing-merge', 'blocks/1/blocks/1/rows/3/cells/1', 'Pricing', 'A4', 'Merged total', anydocProducer, { mergeRange: 'A4:B4' }),
      ...sheetCellFacts('pricing-merge-follower', 'blocks/1/blocks/1/rows/3/cells/2', 'Pricing', 'B4', '', anydocProducer, { mergeRange: 'A4:B4' }),
    ] : []),
  ])
}

function success(fixtureId: string, assertions: readonly StructuralAssertion[]): ExpectedFactManifest {
  return { fixtureId, expectedOutcome: { kind: 'success' }, assertions }
}

type FactAssertion = Exclude<StructuralAssertion, { kind: 'provenance' }>
type UnscopedFactAssertion = FactAssertion extends infer Assertion
  ? Assertion extends unknown ? Omit<Assertion, 'factPath'> : never
  : never

/** Declare a structural fact and its exact, fact-scoped provenance together. */
function fact(assertion: UnscopedFactAssertion, factPath: string, coordinate: SourceCoordinate, producer: ParserIdentity): readonly StructuralAssertion[] {
  return [
    { ...assertion, factPath } as FactAssertion,
    { id: `provenance:${assertion.id}`, role: assertion.role, kind: 'provenance', for: assertion.id, path: factPath, coordinate, producer },
  ]
}

function sheetCellFacts(
  id: string,
  path: string,
  sheet: string,
  address: string,
  displayedValue: string,
  producer: ParserIdentity,
  details: { readonly formula?: string; readonly mergeRange?: string } = {},
): readonly StructuralAssertion[] {
  return fact({ id, role: 'required', kind: 'cell', sheet, address, displayedValue, ...details }, path, { kind: 'sheet-range', sheet, range: address }, producer)
}

function pdfPageFact(page: number, sha256: string): readonly StructuralAssertion[] {
  return fact({ id: `pdf-page-${page}-content`, role: 'required', kind: 'page-content-hash', page, sha256 }, `blocks/${page}`, { kind: 'page', page }, pdfProducer)
}

function coordinateClassMatches(assertion: FactAssertion, coordinate: SourceCoordinate): boolean {
  if (assertion.factPath === 'document') {
    return coordinate.kind === 'document'
  }
  if (assertion.kind === 'cell' || assertion.kind === 'sheet-range') {
    return coordinate.kind === 'sheet-range'
  }
  if (assertion.kind === 'csv-matrix' || assertion.kind === 'logical-row-bounds') {
    return coordinate.kind === 'logical-table'
  }
  if (assertion.kind === 'slide-boundary' || assertion.kind === 'slide-note') {
    return coordinate.kind === 'slide'
  }
  if (assertion.kind === 'page-content-hash') {
    return coordinate.kind === 'page'
  }
  if (assertion.kind === 'page-block' || (assertion.kind === 'table' && coordinate.kind === 'page-block')) {
    return coordinate.kind === 'page-block'
  }
  if (assertion.factPath.startsWith('assets/')) {
    return coordinate.kind === 'document' || coordinate.kind === 'slide'
  }
  return true
}

function failure(fixtureId: string, error: string): ExpectedFactManifest {
  return { fixtureId, expectedOutcome: { kind: 'failure', error }, assertions: [] }
}

function missing(fixtureId: string): ExpectedFactManifest {
  return { fixtureId, expectedOutcome: { kind: 'missing' }, assertions: [] }
}
