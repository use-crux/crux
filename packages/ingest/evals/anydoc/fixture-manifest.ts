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
    readonly provenance: FixtureProvenance
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
  readonly kind: 'generator-recipe' | 'project-fixture' | 'unavailable-source'
  readonly reference: string
  readonly sha256?: string
  readonly license: FixtureLicense
}

interface FixtureExpectedOutcome {
  readonly kind: 'success' | 'failure' | 'missing'
  readonly error?: 'containment-unavailable' | 'encrypted' | 'expanded-too-large' | 'invalid-result' | 'memory-limit' | 'source-too-large' | 'timeout' | 'worker-crash'
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

    if (fixture.availability === 'available' && fixture.expectedOutcome.kind === 'missing') {
      errors.push(`fixture "${fixture.id}" is available but its expected outcome is missing.`)
    }

    if (fixture.availability === 'missing' && fixture.expectedOutcome.kind !== 'missing') {
      errors.push(`fixture "${fixture.id}" has no source bytes but does not declare missing coverage.`)
    }

    if (fixture.expectedOutcome.kind === 'failure' && fixture.expectedOutcome.error === undefined) {
      errors.push(`fixture "${fixture.id}" expects failure without a typed error.`)
    }

    if (fixture.availability === 'available' && fixture.source.kind === 'file' && !/^[a-f0-9]{64}$/.test(fixture.source.sha256)) {
      errors.push(`fixture "${fixture.id}" has an invalid SHA-256 source hash.`)
    }

    if (fixture.source.kind === 'file' && fixture.source.provenance.reference.length === 0) {
      errors.push(`fixture "${fixture.id}" has no generator or project-fixture reference.`)
    }

    if (fixture.source.kind === 'missing' && fixture.source.provenance.kind === 'generator-recipe' && !/^[a-f0-9]{64}$/.test(fixture.source.provenance.sha256 ?? '')) {
      errors.push(`fixture "${fixture.id}" generator recipe has no immutable SHA-256.`)
    }

    const requiredFacts = REQUIRED_FACTS[fixture.useCase]
    if (!sameFacts(fixture.requiredFacts, requiredFacts)) {
      errors.push(`fixture "${fixture.id}" use case "${fixture.useCase}" requires facts "${requiredFacts.join(', ')}".`)
    }

    for (const [resource, ceiling] of Object.entries(ANydocFixtureResourceCeilings) as [keyof typeof ANydocFixtureResourceCeilings, number][]) {
      if (!Number.isSafeInteger(fixture.limits[resource]) || fixture.limits[resource] <= 0) {
        errors.push(`fixture "${fixture.id}" limit "${resource}" must be a positive finite integer.`)
      }
      if (fixture.limits[resource] > ceiling) {
        errors.push(`fixture "${fixture.id}" limit "${resource}" exceeds the global ceiling of ${ceiling}.`)
      }
    }

    if (fixture.id.length === 0 || fixture.source.kind === 'file' && fixture.source.path.length === 0) {
      errors.push(`fixture "${fixture.id}" has an empty identifier or source path.`)
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
  availableFixture('docx-structure-v1', 'docx', 'prose', 'fixtures/prose.docx', '47472cea1ad6756a42b451087a9f28f17732bcb980d07a7414b22eadd2b428ea', 5715, ['anydoc', 'mammoth']),
  availableFixture('doc-legacy-v1', 'doc', 'prose', 'fixtures/prose.doc', '43d7f00b1bd7d0784b20245176327690137891a6e65577ca0f2e2dbb3ab9b1c1', 11264, ['anydoc']),
  availableFixture('docm-macro-v1', 'docm', 'prose', 'fixtures/prose.docm', '47472cea1ad6756a42b451087a9f28f17732bcb980d07a7414b22eadd2b428ea', 5715, ['anydoc']),
  availableFixture('rtf-prose-v1', 'rtf', 'prose', 'fixtures/prose.rtf', '1be57882b7e295a39e752d865ae228315d804c165d8eead8e6f6e0b2ca9596d3', 6230, ['anydoc']),
  availableFixture('odt-prose-v1', 'odt', 'prose', 'fixtures/prose.odt', '69905f44f041bca7bec7243843758d002d6e9d49d4182368efe19c91d82b1fda', 9981, ['anydoc']),
  availableFixture('epub-prose-v1', 'epub', 'prose', 'fixtures/prose.epub', 'e2673c50fba7898dc165005cb44b105b407e04c7c14e630f7e0d21c1dd594407', 2962, ['anydoc']),
  missingFixture('pptx-structure-v1', 'pptx', 'presentation', 'No redistribution-safe PPTX fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('ppt-legacy-v1', 'ppt', 'presentation', 'No redistribution-safe legacy presentation fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('xls-spreadsheet-v1', 'xls', 'spreadsheet-grade', 'No redistribution-safe XLS fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  missingFixture('ods-spreadsheet-v1', 'ods', 'spreadsheet-grade', 'No redistribution-safe ODS fixture is checked in.', 'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation'),
  availableFixture('csv-control-v1', 'csv', 'csv-table', 'fixtures/csv-control-v1.csv', '416a2ff58e53cb4196bff8bbd9c67ec4253788f2e86fca317628b15e092b02e5', 45, ['csv-parse']),
  availableFixture('xlsx-control-v1', 'xlsx', 'spreadsheet-grade', 'fixtures/sheet.xlsx', '3eab7f712ee5bc6f00d044040afb79f0fe9d885e1cf47a7a1d89aa445b7a113c', 6434, ['anydoc', 'exceljs'], ['exceljs']),
  availableFixture('pdf-control-v1', 'pdf', 'pdf-page', '../../__tests__/fixtures/layout-aware-mixed.pdf', 'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924', 36444, ['pdf-inspector'], ['pdf-inspector']),
  hostileFixture('encrypted-v1', 'fixtures/encrypted.docx', '0714ae19759858673427af251a27e5712b539aed8470c1800075b363d41e349a', 4998, ['encrypted'], 'encrypted'),
  hostileFixture('truncated-v1', 'fixtures/truncated.docx', '64f765c7aa8e2e5f4f4a7c90d1cc2b7afcaa29bea87493a490ff5b5e75ad9b58', 32, ['truncated'], 'invalid-result'),
  hostileFixture('malformed-v1', 'fixtures/malformed.docx', '76b88821421dc40df237bee3a69fecd76003240e5bac3fe31b5f5cedc700e90f', 18, ['malformed'], 'invalid-result'),
  { ...availableFixture('mislabeled-v1', 'docx', 'prose', 'fixtures/mislabeled.docx', 'ed7e13db986967d27375e3aa61e6984c45449d3d6da69f573031a1fa3a375556', 76, ['anydoc']), actualFormat: 'rtf', tags: ['mislabeled'] },
  missingFixture('expansion-heavy-v1', 'docx', 'prose', 'Recipe intentionally creates expansion bytes only in a bounded temporary directory; no decompression bomb is committed.', 'packages/ingest/evals/anydoc/generate-fixtures.mjs', ['expansion-heavy']),
  missingFixture('timeout-v1', 'docx', 'prose', 'Runner-only deterministic recipe requires a wall-time limit and is not a static parser input.', 'packages/ingest/evals/anydoc/generate-fixtures.mjs', ['external-link']),
  missingFixture('memory-limit-v1', 'docx', 'prose', 'Runner-only deterministic recipe requires verified containment and is not a static parser input.', 'packages/ingest/evals/anydoc/generate-fixtures.mjs', ['external-link']),
  missingFixture('containment-unavailable-v1', 'docx', 'prose', 'Runner-only deterministic recipe tests absent host containment before Anydoc loads.', 'packages/ingest/evals/anydoc/generate-fixtures.mjs', ['external-link']),
]

function availableFixture(id: string, format: FixtureFormat, useCase: FixtureUseCase, path: string, sha256: string, byteLength: number, candidates: readonly string[], controls?: readonly string[]): AnydocFixtureManifest {
  const generated = path !== 'fixtures/csv-control-v1.csv' && !path.includes('__tests__')
  return {
    id, availability: 'available', source: {
      kind: 'file', path, sha256, byteLength, license: { kind: 'project-owned' },
      provenance: generated
        ? { kind: 'generator-recipe', reference: 'packages/ingest/evals/anydoc/generate-fixtures.mjs', sha256: '992f872819c2c15c71023fe7651c7e0e833ed2f82d1f565c0bcebfa7e837403f', license: { kind: 'project-owned' } }
        : { kind: 'project-fixture', reference: path, license: { kind: 'project-owned' } },
    }, declaredFormat: format, actualFormat: format,
    useCase, requiredFacts: REQUIRED_FACTS[useCase], parserApplicability: { candidates, controls }, expectedOutcome: { kind: 'success' }, tags: ['control'], limits,
  }
}

function hostileFixture(id: string, path: string, sha256: string, byteLength: number, tags: readonly FixtureTag[], error: NonNullable<FixtureExpectedOutcome['error']>): AnydocFixtureManifest {
  return {
    ...availableFixture(id, 'docx', 'prose', path, sha256, byteLength, ['anydoc']),
    expectedOutcome: { kind: 'failure', error }, tags,
  }
}

function missingFixture(id: string, format: FixtureFormat, useCase: FixtureUseCase, reason: string, reference: string, tags: readonly FixtureTag[] = [], actualFormat = format, recipeSha256?: string): AnydocFixtureManifest {
  return {
    id, availability: 'missing', source: missing(reason, reference, recipeSha256), declaredFormat: format, actualFormat,
    useCase, requiredFacts: REQUIRED_FACTS[useCase], parserApplicability: { candidates: ['anydoc'] }, expectedOutcome: { kind: 'missing' }, tags, limits,
  }
}
