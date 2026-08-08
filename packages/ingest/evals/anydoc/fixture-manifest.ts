import { createHash } from 'node:crypto'

export const ANydocFixtureResourceCeilings = {
  sourceBytes: 32 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  wallMilliseconds: 30_000,
  cpuMilliseconds: 20_000,
  peakRssBytes: 512 * 1024 * 1024,
  resultBytes: 8 * 1024 * 1024,
  stdoutBytes: 64 * 1024,
  stderrBytes: 64 * 1024,
  assetCount: 128,
  assetBytes: 64 * 1024 * 1024,
} as const

type FixtureFormat = 'csv' | 'doc' | 'docm' | 'docx' | 'epub' | 'ods' | 'odt' | 'pdf' | 'ppt' | 'pptx' | 'rtf' | 'text' | 'xls' | 'xlsx'
type FixtureUseCase = 'csv-table' | 'pdf-page' | 'presentation' | 'prose' | 'spreadsheet-grade'
type FixtureTag = 'control' | 'encrypted' | 'expansion-heavy' | 'external-link' | 'malformed' | 'mislabeled' | 'truncated'
type RequiredFact =
  | 'all-text-in-order'
  | 'assets'
  | 'columns'
  | 'coordinates'
  | 'deterministic-diagnostics'
  | 'formulas-and-merges'
  | 'heading-levels'
  | 'link-targets'
  | 'list-nesting'
  | 'logical-matrix'
  | 'notes-and-assets'
  | 'occupied-ranges'
  | 'page-block-coordinates'
  | 'page-content'
  | 'page-count-and-order'
  | 'page-metadata'
  | 'row-bounds'
  | 'sheet-identity-and-order'
  | 'slide-boundaries'
  | 'slide-identity-and-order'
  | 'slide-note-ownership'
  | 'table-grid'

type FixtureSource =
  | {
    readonly kind: 'file'
    readonly path: string
    readonly sha256: string
    readonly byteLength: number
    readonly license: FixtureLicense
  }
  | {
    readonly kind: 'missing'
    readonly reason: string
    readonly provenance: FixtureProvenance
  }

interface FixtureLicense {
  readonly kind: 'project-owned' | 'redistributable'
  readonly identifier?: string
}

interface FixtureProvenance {
  readonly kind: 'generator-recipe' | 'unavailable-source'
  readonly reference: string
  readonly sha256?: string
  readonly license: FixtureLicense
}

interface FixtureExpectedOutcome {
  readonly kind: 'success' | 'missing'
  readonly error?: 'expanded-too-large' | 'invalid-result' | 'source-too-large' | 'worker-crash'
}

export interface AnydocFixtureManifest {
  readonly id: string
  readonly availability: 'available' | 'missing'
  readonly source: FixtureSource
  readonly declaredFormat: FixtureFormat
  readonly actualFormat: FixtureFormat
  readonly useCase: FixtureUseCase
  readonly requiredFacts: readonly RequiredFact[]
  readonly parserApplicability: {
    readonly candidates: readonly string[]
    readonly controls?: readonly string[]
  }
  readonly expectedOutcome: FixtureExpectedOutcome
  readonly tags: readonly FixtureTag[]
  readonly limits: typeof ANydocFixtureResourceCeilings
}

const REQUIRED_FACTS: Readonly<Record<FixtureUseCase, readonly RequiredFact[]>> = {
  prose: ['all-text-in-order', 'heading-levels', 'list-nesting', 'table-grid', 'link-targets', 'notes-and-assets', 'coordinates'],
  presentation: ['all-text-in-order', 'heading-levels', 'list-nesting', 'table-grid', 'link-targets', 'notes-and-assets', 'coordinates', 'slide-identity-and-order', 'slide-boundaries', 'slide-note-ownership'],
  'spreadsheet-grade': ['sheet-identity-and-order', 'occupied-ranges', 'all-text-in-order', 'formulas-and-merges', 'coordinates'],
  'csv-table': ['logical-matrix', 'columns', 'row-bounds', 'deterministic-diagnostics'],
  'pdf-page': ['page-count-and-order', 'page-content', 'page-block-coordinates', 'page-metadata', 'deterministic-diagnostics'],
}

export function validateFixtureManifest(manifests: readonly AnydocFixtureManifest[]): string[] {
  const errors: string[] = []
  const ids = new Set<string>()

  for (const fixture of manifests) {
    if (ids.has(fixture.id)) {
      errors.push(`fixture "${fixture.id}" is declared more than once.`)
    }
    ids.add(fixture.id)

    if (fixture.actualFormat !== fixture.declaredFormat && !fixture.tags.includes('mislabeled')) {
      errors.push(`fixture "${fixture.id}" declares format "${fixture.declaredFormat}" but actual format "${fixture.actualFormat}" without the "mislabeled" feature tag.`)
    }

    if (fixture.availability === 'missing' && (fixture.source.kind !== 'missing' || fixture.source.reason.length === 0)) {
      errors.push(`fixture "${fixture.id}" marks coverage missing without a reason.`)
    }

    if (fixture.availability === 'available' && fixture.source.kind !== 'file') {
      errors.push(`fixture "${fixture.id}" is available without immutable source bytes.`)
    }

    if (fixture.availability === 'available' && fixture.source.kind === 'file' && !/^[a-f0-9]{64}$/.test(fixture.source.sha256)) {
      errors.push(`fixture "${fixture.id}" has an invalid SHA-256 source hash.`)
    }

    if (fixture.source.kind === 'missing' && fixture.source.provenance.kind === 'generator-recipe' && !/^[a-f0-9]{64}$/.test(fixture.source.provenance.sha256 ?? '')) {
      errors.push(`fixture "${fixture.id}" generator recipe has no immutable SHA-256.`)
    }

    const requiredFacts = REQUIRED_FACTS[fixture.useCase]
    if (!sameFacts(fixture.requiredFacts, requiredFacts)) {
      errors.push(`fixture "${fixture.id}" use case "${fixture.useCase}" requires facts "${requiredFacts.join(', ')}".`)
    }

    for (const [resource, ceiling] of Object.entries(ANydocFixtureResourceCeilings) as [keyof typeof ANydocFixtureResourceCeilings, number][]) {
      if (fixture.limits[resource] > ceiling) {
        errors.push(`fixture "${fixture.id}" limit "${resource}" exceeds the global ceiling of ${ceiling}.`)
      }
    }

    if (fixture.parserApplicability.candidates.length === 0) {
      errors.push(`fixture "${fixture.id}" has no applicable parser candidate.`)
    }
  }

  return errors
}

export function validateFixtureSourceHash(fixture: AnydocFixtureManifest, bytes: Uint8Array): string | undefined {
  if (fixture.source.kind !== 'file') {
    return undefined
  }

  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== fixture.source.sha256) {
    return `fixture "${fixture.id}" source SHA-256 mismatch: expected ${fixture.source.sha256}, received ${actual}.`
  }

  return undefined
}

function sameFacts(actual: readonly RequiredFact[], required: readonly RequiredFact[]): boolean {
  return actual.length === required.length && required.every((fact) => actual.includes(fact))
}

const limits = ANydocFixtureResourceCeilings
const missing = (reason: string, reference: string, recipeSha256?: string): FixtureSource => ({
  kind: 'missing',
  reason,
  provenance: {
    kind: recipeSha256 ? 'generator-recipe' : 'unavailable-source',
    reference,
    sha256: recipeSha256,
    license: { kind: 'project-owned' },
  },
})

export const fixtureManifests: readonly AnydocFixtureManifest[] = [
  missingFixture('docx-structure-v1', 'docx', 'prose', 'DOCX structure fixture is generated by the existing test helper and has no redistributable checked-in bytes.', 'packages/ingest/__tests__/docx-schema-2.test.ts#makeDocx', [], 'docx', 'b4f16fc60bd9f8d93d83ed6b5472e9fd75cff2e95adf16e90d9b6e6fc60930cf'),
  missingFixture('doc-legacy-v1', 'doc', 'prose', 'No redistribution-safe legacy DOC fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('docm-macro-v1', 'docm', 'prose', 'No redistribution-safe DOCM fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('rtf-prose-v1', 'rtf', 'prose', 'No redistribution-safe RTF fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('odt-prose-v1', 'odt', 'prose', 'No redistribution-safe ODT fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('epub-prose-v1', 'epub', 'prose', 'No redistribution-safe EPUB fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('pptx-structure-v1', 'pptx', 'presentation', 'No redistribution-safe PPTX fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('ppt-legacy-v1', 'ppt', 'presentation', 'No redistribution-safe legacy presentation fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('xls-spreadsheet-v1', 'xls', 'spreadsheet-grade', 'No redistribution-safe XLS fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('ods-spreadsheet-v1', 'ods', 'spreadsheet-grade', 'No redistribution-safe ODS fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  availableFixture('csv-control-v1', 'csv', 'csv-table', 'fixtures/csv-control-v1.csv', '416a2ff58e53cb4196bff8bbd9c67ec4253788f2e86fca317628b15e092b02e5', 45, ['csv-parse']),
  missingFixture('xlsx-control-v1', 'xlsx', 'spreadsheet-grade', 'XLSX control is generated in the existing schema-2 test and has no redistributable checked-in bytes.', 'packages/ingest/__tests__/xlsx-schema-2.test.ts', [], 'xlsx', 'c7eea5999b209cba837586da9bff231fc29c5c93cd11a64b75d18503d5da347d'),
  availableFixture('pdf-control-v1', 'pdf', 'pdf-page', '../../__tests__/fixtures/layout-aware-mixed.pdf', 'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924', 36444, ['pdf-inspector'], ['pdf-inspector']),
  missingFixture('encrypted-v1', 'docx', 'prose', 'No redistribution-safe encrypted fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation', ['encrypted']),
  missingFixture('truncated-v1', 'docx', 'prose', 'No redistribution-safe truncated fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation', ['truncated']),
  missingFixture('mislabeled-v1', 'docx', 'prose', 'No redistribution-safe mislabeled fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation', ['mislabeled'], 'text'),
  missingFixture('expansion-heavy-v1', 'docx', 'prose', 'No redistribution-safe expansion-heavy fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation', ['expansion-heavy']),
  missingFixture('external-link-v1', 'docx', 'prose', 'No redistribution-safe external-link fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation', ['external-link']),
]

function availableFixture(id: string, format: FixtureFormat, useCase: FixtureUseCase, path: string, sha256: string, byteLength: number, candidates: readonly string[], controls?: readonly string[]): AnydocFixtureManifest {
  return {
    id, availability: 'available', source: { kind: 'file', path, sha256, byteLength, license: { kind: 'project-owned' } }, declaredFormat: format, actualFormat: format,
    useCase, requiredFacts: REQUIRED_FACTS[useCase], parserApplicability: { candidates, controls }, expectedOutcome: { kind: 'success' }, tags: ['control'], limits,
  }
}

function missingFixture(id: string, format: FixtureFormat, useCase: FixtureUseCase, reason: string, reference: string, tags: readonly FixtureTag[] = [], actualFormat = format, recipeSha256?: string): AnydocFixtureManifest {
  return {
    id, availability: 'missing', source: missing(reason, reference, recipeSha256), declaredFormat: format, actualFormat,
    useCase, requiredFacts: REQUIRED_FACTS[useCase], parserApplicability: { candidates: ['anydoc'] }, expectedOutcome: { kind: 'missing' }, tags, limits,
  }
}
