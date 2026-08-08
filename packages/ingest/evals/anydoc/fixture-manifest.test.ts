import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import {
  ANydocFixtureResourceCeilings,
  fixtureManifests,
  validateFixtureManifest,
  validateFixtureSourceHash,
  type AnydocFixtureManifest,
} from './fixture-manifest'

it('accepts the offline fixture catalogue and its immutable source hashes', () => {
  expect(validateFixtureManifest(fixtureManifests)).toEqual([])
  expect(fixtureManifests.map((fixture) => fixture.id)).toEqual(
    expect.arrayContaining([
      'docx-structure-v1',
      'doc-legacy-v1',
      'docm-macro-v1',
      'rtf-prose-v1',
      'odt-prose-v1',
      'epub-prose-v1',
      'pptx-structure-v1',
      'ppt-legacy-v1',
      'csv-control-v1',
      'xlsx-control-v1',
      'pdf-control-v1',
    ]),
  )
})

it('materializes every binding Phase 2 corpus case', () => {
  const required = [
    'pptx-structure-v1',
    'xls-spreadsheet-v1',
    'ods-spreadsheet-v1',
    'external-link-v1',
    'expansion-heavy-v1',
  ]

  for (const id of required) {
    expect(fixtureManifests.find((fixture) => fixture.id === id)?.availability, id).toBe('available')
  }
})

it('records structural facts rather than inferring coverage from extensions', () => {
  const facts = (id: string) => fixtureManifests.find((fixture) => fixture.id === id)?.inspectedFacts

  expect(facts('docx-structure-v1')).toEqual(expect.arrayContaining(['footnote', 'embedded-image']))
  expect(facts('pptx-structure-v1')).toEqual(
    expect.arrayContaining(['ordered-slides', 'slide-notes', 'table', 'embedded-image']),
  )
  expect(facts('xls-spreadsheet-v1')).toEqual(expect.arrayContaining(['ordered-sheets', 'merged-cells']))
  expect(facts('ods-spreadsheet-v1')).toEqual(expect.arrayContaining(['ordered-sheets', 'formula', 'merged-cells']))
  expect(facts('external-link-v1')).toContain('external-relationship')
})

it('inspects the declared Office structure in the canonical bytes', async () => {
  const fixtureBytes = async (name: string) => readFile(new URL(`fixtures/${name}`, import.meta.url))
  const docx = await JSZip.loadAsync(await fixtureBytes('prose.docx'))
  const pptx = await JSZip.loadAsync(await fixtureBytes('slides.pptx'))
  const ods = await JSZip.loadAsync(await fixtureBytes('sheet.ods'))
  const xls = XLSX.read(await fixtureBytes('sheet.xls'), { type: 'buffer', cellFormula: true })

  expect(docx.file('word/footnotes.xml')).not.toBeNull()
  expect(docx.file('word/media/crux.png')).not.toBeNull()
  expect(Object.keys(pptx.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))).toHaveLength(2)
  expect(Object.keys(pptx.files).filter((path) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path))).toHaveLength(2)
  expect(await pptx.file('ppt/slides/slide1.xml')?.async('string')).toContain('<a:tbl>')
  expect(pptx.file('ppt/media/image-2-1.png')).not.toBeNull()
  expect(xls.SheetNames).toEqual(['Pricing', 'Regions'])
  expect(xls.Sheets.Pricing.C2?.v).toBe(24)
  expect(xls.Sheets.Pricing['!merges']).toEqual([{ s: { c: 0, r: 3 }, e: { c: 1, r: 3 } }])
  const odsContent = await ods.file('content.xml')?.async('string')
  expect(odsContent).toContain('table:formula="of:=[.B2]*1.2"')
  expect(odsContent).toContain('table:number-columns-spanned="2"')
})

it('matches every available fixture’s checked-in source length and SHA-256', async () => {
  for (const fixture of fixtureManifests) {
    if (fixture.source.kind !== 'file') {
      continue
    }

    const bytes = await readFile(new URL(fixture.source.path, import.meta.url))
    expect(bytes.byteLength, fixture.id).toBe(fixture.source.byteLength)
    expect(validateFixtureSourceHash(fixture, bytes), fixture.id).toBeUndefined()
  }
})

it('rejects bytes that do not match an available fixture’s checked-in SHA-256', async () => {
  const fixture = fixtureManifests.find((candidate) => candidate.id === 'csv-control-v1')
  if (!fixture || fixture.source.kind !== 'file') {
    throw new Error('Expected the CSV control fixture.')
  }

  const bytes = await readFile(new URL(fixture.source.path, import.meta.url))
  expect(validateFixtureSourceHash(fixture, bytes)).toBeUndefined()
  expect(validateFixtureSourceHash(fixture, new TextEncoder().encode('changed'))).toBe(
    `fixture "csv-control-v1" source SHA-256 mismatch: expected ${fixture.source.sha256}, received d67e2e944994496c8d8ec76eed0cf9f09679448d584b532bebf941852a37f5ed.`,
  )
})

it('requires a declared actual-format mismatch to be an explicit hostile fixture', () => {
  const fixture = validFixture({ actualFormat: 'text', tags: ['control'] })

  expect(validateFixtureManifest([fixture])).toEqual([
    'fixture "csv-control-v1" declares format "csv" but actual format "text" without the "mislabeled" feature tag.',
  ])
})

it('requires a mislabeled fixture to fail closed with a typed outcome', () => {
  const fixture = validFixture({
    actualFormat: 'text',
    tags: ['mislabeled'],
    expectedOutcome: { kind: 'success' },
  })

  expect(validateFixtureManifest([fixture])).toEqual([
    'fixture "csv-control-v1" is mislabeled but does not fail closed with a typed error.',
  ])
})

it('requires missing coverage to say why its source bytes are unavailable', () => {
  const fixture = validFixture({
    availability: 'missing',
    source: {
      kind: 'missing',
      reason: '',
      provenance: {
        kind: 'unavailable-source',
        reference: 'fixture request',
        license: { kind: 'project-owned' },
      },
    },
  })

  expect(validateFixtureManifest([fixture])).toEqual([
    'fixture "csv-control-v1" marks coverage missing without a reason.',
    'fixture "csv-control-v1" has no source bytes but does not declare missing coverage.',
  ])
})

it('treats checked-in bytes as canonical even when a convenience generator is recorded', () => {
  const fixture = validFixture({
    source: {
      kind: 'file',
      path: 'fixtures/csv-control-v1.csv',
      sha256: '416a2ff58e53cb4196bff8bbd9c67ec4253788f2e86fca317628b15e092b02e5',
      byteLength: 45,
      license: { kind: 'project-owned' },
      provenance: {
        kind: 'generator-recipe',
        reference: 'fixture-generator.ts',
        license: { kind: 'project-owned' },
      },
    },
  })

  expect(validateFixtureManifest([fixture])).toEqual([])
})

it('rejects fixture resource limits that exceed the binding global ceilings', () => {
  const fixture = validFixture({
    limits: { ...ANydocFixtureResourceCeilings, sourceBytes: ANydocFixtureResourceCeilings.sourceBytes + 1 },
  })

  expect(validateFixtureManifest([fixture])).toEqual([
    `fixture "csv-control-v1" limit "sourceBytes" exceeds the global ceiling of ${ANydocFixtureResourceCeilings.sourceBytes}.`,
  ])
})

it('rejects a use case without its complete required-fact contract', () => {
  const fixture = validFixture({ requiredFacts: ['logical-matrix'] })

  expect(validateFixtureManifest([fixture])).toEqual([
    'fixture "csv-control-v1" use case "csv-table" requires facts "logical-matrix, columns, row-bounds, deterministic-diagnostics".',
  ])
})

function validFixture(overrides: Partial<AnydocFixtureManifest> = {}): AnydocFixtureManifest {
  return {
    id: 'csv-control-v1',
    availability: 'available',
    source: {
      kind: 'file',
      path: 'fixtures/csv-control-v1.csv',
      sha256: '416a2ff58e53cb4196bff8bbd9c67ec4253788f2e86fca317628b15e092b02e5',
      byteLength: 45,
      license: { kind: 'project-owned' },
      provenance: {
        kind: 'project-fixture',
        reference: 'fixtures/csv-control-v1.csv',
        license: { kind: 'project-owned' },
      },
    },
    declaredFormat: 'csv',
    actualFormat: 'csv',
    useCase: 'csv-table',
    requiredFacts: ['logical-matrix', 'columns', 'row-bounds', 'deterministic-diagnostics'],
    parserApplicability: { candidates: ['csv-parse'], controls: ['csv-parse'] },
    expectedOutcome: { kind: 'success' },
    tags: ['control'],
    inspectedFacts: [],
    limits: ANydocFixtureResourceCeilings,
    ...overrides,
  }
}
