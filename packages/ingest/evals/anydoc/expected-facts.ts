import type { AnydocFixtureManifest, RequiredFact } from './fixture-manifest'
import type { ExpectedFactManifest, StructuralAssertion } from './structural-assertions'

function proseAssertions(options: { readonly notes?: readonly string[]; readonly assetCount?: number } = {}): readonly StructuralAssertion[] {
  return [
  { id: 'prose-text', role: 'required', kind: 'ordered-text', text: ['Release Notes', 'Structured ingestion reference.', 'First', 'Nested', 'Plan', 'Status', 'Pro', 'Ready'] },
  { id: 'prose-heading', role: 'required', kind: 'heading', level: 1, text: 'Release Notes' },
  { id: 'prose-list', role: 'required', kind: 'list', ordered: false, depth: 1, text: ['First', 'Nested'] },
  { id: 'prose-nested-list', role: 'required', kind: 'list', ordered: false, depth: 2, text: ['Nested'] },
  { id: 'prose-table', role: 'required', kind: 'table', columns: ['Plan', 'Status'], rows: [['Plan', 'Status'], ['Pro', 'Ready']] },
  { id: 'prose-link', role: 'required', kind: 'link', text: 'reference', target: 'https://cruxjs.dev' },
  { id: 'prose-notes', role: 'required', kind: 'notes', text: options.notes ?? [] },
  { id: 'prose-assets', role: 'required', kind: 'asset-count', count: options.assetCount ?? 0 },
  { id: 'prose-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['document'] },
  ]
}

const COVERAGE: Readonly<Record<RequiredFact, readonly StructuralAssertion['kind'][]>> = {
  'all-text-in-order': ['ordered-text'], assets: ['asset-count'], columns: ['table'], coordinates: ['coordinate-kinds', 'cell', 'logical-row-bounds', 'page-block'],
  'deterministic-diagnostics': ['no-parser-downgrade', 'parser-downgrade'], 'formulas-and-merges': ['cell'], 'heading-levels': ['heading'],
  'link-targets': ['link'], 'list-nesting': ['list'], 'logical-matrix': ['csv-matrix'], 'notes-and-assets': ['notes', 'asset-count'],
  'occupied-ranges': ['sheet-range'], 'page-block-coordinates': ['page-block'], 'page-content': ['page-block'], 'page-count-and-order': ['page-order'],
  'page-metadata': ['metadata'], 'row-bounds': ['logical-row-bounds'], 'sheet-identity-and-order': ['sheet-order'],
  'slide-boundaries': ['slide-boundary'], 'slide-identity-and-order': ['slide-order'], 'slide-note-ownership': ['slide-note'], 'table-grid': ['table'],
}

/**
 * Corpus facts are deliberately typed schema-2 expectations, never rendered
 * Markdown snapshots. Every fixture, including unavailable cases, has one.
 */
export const expectedFactsByFixture: Readonly<Record<string, ExpectedFactManifest>> = {
  'docx-structure-v1': success('docx-structure-v1', [
    ...proseAssertions({ notes: ['Crux footnote evidence.'], assetCount: 1 }),
  ]),
  'doc-legacy-v1': success('doc-legacy-v1', proseAssertions()),
  'docm-macro-v1': missing('docm-macro-v1'),
  'rtf-prose-v1': success('rtf-prose-v1', proseAssertions()),
  'odt-prose-v1': success('odt-prose-v1', proseAssertions()),
  'epub-prose-v1': success('epub-prose-v1', proseAssertions()),
  'pptx-structure-v1': success('pptx-structure-v1', [
    { id: 'slides', role: 'required', kind: 'slide-order', slides: [1, 2] },
    { id: 'slide-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['slide'] },
    { id: 'slide-1-boundary', role: 'required', kind: 'slide-boundary', slide: 1, text: ['Slide One', 'Plan', 'Status', 'Pro', 'Ready'] },
    { id: 'slide-2-boundary', role: 'required', kind: 'slide-boundary', slide: 2, text: ['Slide Two'] },
    { id: 'slide-text', role: 'required', kind: 'ordered-text', text: ['Slide One', 'Plan', 'Status', 'Pro', 'Ready', 'Slide Two'] },
    { id: 'slide-table', role: 'required', kind: 'table', columns: ['Plan', 'Status'], rows: [['Plan', 'Status'], ['Pro', 'Ready']] },
    { id: 'slide-1-note', role: 'required', kind: 'slide-note', slide: 1, text: 'Owner note for slide one.' },
    { id: 'slide-2-note', role: 'required', kind: 'slide-note', slide: 2, text: 'Owner note for slide two.' },
    { id: 'slide-assets', role: 'required', kind: 'asset-count', count: 1 },
  ]),
  'ppt-legacy-v1': missing('ppt-legacy-v1'),
  'xls-spreadsheet-v1': spreadsheet('xls-spreadsheet-v1', true),
  'ods-spreadsheet-v1': spreadsheet('ods-spreadsheet-v1', true),
  'csv-control-v1': success('csv-control-v1', [
    { id: 'csv-matrix', role: 'required', kind: 'csv-matrix', matrix: [['Plan', 'Price', 'Notes'], ['Pro', '20', 'best, value'], ['Free', '', '']] },
    { id: 'csv-row-bounds', role: 'required', kind: 'logical-row-bounds', start: 1, end: 3 },
    { id: 'csv-table', role: 'required', kind: 'table', columns: ['Plan', 'Price', 'Notes'], rows: [['Plan', 'Price', 'Notes'], ['Pro', '20', 'best, value'], ['Free', '', '']] },
    { id: 'csv-diagnostics', role: 'required', kind: 'no-parser-downgrade' },
  ]),
  'xlsx-control-v1': success('xlsx-control-v1', [
    { id: 'xlsx-sheets', role: 'required', kind: 'sheet-order', sheets: ['Pricing'] },
    { id: 'xlsx-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['sheet-range'] },
    { id: 'xlsx-text', role: 'required', kind: 'ordered-text', text: ['Plan', 'Price', 'Pro', '20'] },
    { id: 'xlsx-range', role: 'required', kind: 'sheet-range', sheet: 'Pricing', range: 'A1:B2' },
    { id: 'xlsx-a1', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'A1', displayedValue: 'Plan' },
    { id: 'xlsx-b1', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'B1', displayedValue: 'Price' },
    { id: 'xlsx-a2', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'A2', displayedValue: 'Pro' },
    { id: 'xlsx-b2', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'B2', displayedValue: '20' },
  ]),
  'pdf-control-v1': success('pdf-control-v1', [
    { id: 'pdf-pages', role: 'required', kind: 'page-order', pages: [1, 2, 3, 4, 5, 6, 7, 8] },
    { id: 'pdf-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['page', 'page-block'] },
    { id: 'pdf-title', role: 'required', kind: 'metadata', key: 'title', value: 'Firecrawl Documentation - API Reference' },
    { id: 'pdf-first-block', role: 'required', kind: 'page-block', page: 1, block: 1, text: '# Firecrawl API Documentation' },
    { id: 'pdf-page-1-content', role: 'required', kind: 'page-content-hash', page: 1, sha256: '7a024ee44003f09f5bce3202a4b0e34fd2317d71b9c7ab71328fa30c9783201c' },
    { id: 'pdf-page-2-content', role: 'required', kind: 'page-content-hash', page: 2, sha256: 'a7c92134f7a533ba743cd6185c3711f49aba00b288dce4af24ca32492d6d125c' },
    { id: 'pdf-page-3-content', role: 'required', kind: 'page-content-hash', page: 3, sha256: '87f483fbfa31397abb0ff03943aa3131d270b0789abc7598da46abe355a5a6ea' },
    { id: 'pdf-page-4-content', role: 'required', kind: 'page-content-hash', page: 4, sha256: 'fa3c17a449ee28cf01070dd3d8e5ee159cb616124b02f6c245f228bdfac01c74' },
    { id: 'pdf-page-5-content', role: 'required', kind: 'page-content-hash', page: 5, sha256: '72dc1ed3b91129a095e4d16fb5aea46fd21fb32e48f93c3f0fb5be866add9c0b' },
    { id: 'pdf-page-6-content', role: 'required', kind: 'page-content-hash', page: 6, sha256: 'fe44a2e589c2ed754e55bd070f47f52daa9acb89b3c1e2d3469c5f7ff48f3ca3' },
    { id: 'pdf-page-7-content', role: 'required', kind: 'page-content-hash', page: 7, sha256: '0ff7075883eef9b740278f7ac7ee4c85f1e6cbf913d336d8761582b633b73171' },
    { id: 'pdf-page-8-content', role: 'required', kind: 'page-content-hash', page: 8, sha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
    { id: 'pdf-table', role: 'required', kind: 'table', columns: ['Parameter', 'Type', 'Default', 'Description'], rows: [['Parameter', 'Type', 'Default', 'Description']] },
    { id: 'pdf-native-primary', role: 'required', kind: 'no-parser-downgrade' },
  ]),
  'encrypted-v1': missing('encrypted-v1'),
  'truncated-v1': failure('truncated-v1', 'invalid-result'),
  'malformed-v1': failure('malformed-v1', 'invalid-result'),
  'mislabeled-v1': failure('mislabeled-v1', 'invalid-result'),
  'expansion-heavy-v1': failure('expansion-heavy-v1', 'expanded-too-large'),
  'external-link-v1': {
    fixtureId: 'external-link-v1', expectedOutcome: { kind: 'success', diagnostic: 'external-resource-blocked' }, assertions: proseAssertions(),
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

export function validateExpectedFacts(manifests: readonly AnydocFixtureManifest[]): string[] {
  const errors: string[] = []
  for (const fixture of manifests) {
    const expected = expectedFactsByFixture[fixture.id]
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
  }
  return errors
}

function spreadsheet(fixtureId: string, hasMerge: boolean): ExpectedFactManifest {
  return success(fixtureId, [
    { id: 'workbook-sheets', role: 'required', kind: 'sheet-order', sheets: ['Pricing', 'Regions'] },
    { id: 'workbook-coordinates', role: 'required', kind: 'coordinate-kinds', kinds: ['sheet-range'] },
    { id: 'workbook-text', role: 'required', kind: 'ordered-text', text: ['Plan', 'Price', 'Taxed', 'Pro', '20', '24', 'Merged total', 'Region', 'EU'] },
    { id: 'pricing-range', role: 'required', kind: 'sheet-range', sheet: 'Pricing', range: 'A1:C4' },
    { id: 'regions-range', role: 'required', kind: 'sheet-range', sheet: 'Regions', range: 'A1:A2' },
    { id: 'pricing-a1', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'A1', displayedValue: 'Plan' },
    { id: 'pricing-b1', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'B1', displayedValue: 'Price' },
    { id: 'pricing-c1', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'C1', displayedValue: 'Taxed' },
    { id: 'pricing-a2', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'A2', displayedValue: 'Pro' },
    { id: 'pricing-b2', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'B2', displayedValue: '20' },
    { id: 'pricing-c2', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'C2', displayedValue: '24', formula: 'B2*1.2' },
    { id: 'pricing-c4', role: 'required', kind: 'cell', sheet: 'Pricing', address: 'C4', displayedValue: '' },
    { id: 'regions-a1', role: 'required', kind: 'cell', sheet: 'Regions', address: 'A1', displayedValue: 'Region' },
    { id: 'regions-a2', role: 'required', kind: 'cell', sheet: 'Regions', address: 'A2', displayedValue: 'EU' },
    ...(hasMerge ? [
      { id: 'pricing-merge', role: 'required' as const, kind: 'cell' as const, sheet: 'Pricing', address: 'A4', displayedValue: 'Merged total', mergeRange: 'A4:B4' },
      { id: 'pricing-merge-follower', role: 'required' as const, kind: 'cell' as const, sheet: 'Pricing', address: 'B4', displayedValue: '', mergeRange: 'A4:B4' },
    ] : []),
  ])
}

function success(fixtureId: string, assertions: readonly StructuralAssertion[]): ExpectedFactManifest {
  return { fixtureId, expectedOutcome: { kind: 'success' }, assertions }
}

function failure(fixtureId: string, error: string): ExpectedFactManifest {
  return { fixtureId, expectedOutcome: { kind: 'failure', error }, assertions: [] }
}

function missing(fixtureId: string): ExpectedFactManifest {
  return { fixtureId, expectedOutcome: { kind: 'missing' }, assertions: [] }
}
