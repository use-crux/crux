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

type FixtureFormat =
  | 'csv'
  | 'doc'
  | 'docm'
  | 'docx'
  | 'epub'
  | 'ods'
  | 'odt'
  | 'pdf'
  | 'ppt'
  | 'pptx'
  | 'rtf'
  | 'text'
  | 'xls'
  | 'xlsx'
type FixtureUseCase = 'csv-table' | 'pdf-page' | 'presentation' | 'prose' | 'spreadsheet-grade'
type FixtureTag =
  | 'control'
  | 'encrypted'
  | 'expansion-heavy'
  | 'external-link'
  | 'malformed'
  | 'mislabeled'
  | 'truncated'
type InspectedFact =
  | 'embedded-image'
  | 'external-relationship'
  | 'footnote'
  | 'formula'
  | 'merged-cells'
  | 'ordered-sheets'
  | 'ordered-slides'
  | 'slide-notes'
  | 'table'
export type RequiredFact =
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
  readonly license: FixtureLicense
}

interface FixtureExpectedOutcome {
  readonly kind: 'success' | 'failure' | 'missing'
  readonly error?:
    | 'containment-unavailable'
    | 'encrypted'
    | 'expanded-too-large'
    | 'invalid-result'
    | 'memory-limit'
    | 'source-too-large'
    | 'timeout'
    | 'worker-crash'
  readonly diagnostic?: 'external-resource-blocked'
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
  readonly inspectedFacts: readonly InspectedFact[]
  readonly limits: typeof ANydocFixtureResourceCeilings
}

const REQUIRED_FACTS: Readonly<Record<FixtureUseCase, readonly RequiredFact[]>> = {
  prose: [
    'all-text-in-order',
    'heading-levels',
    'list-nesting',
    'table-grid',
    'link-targets',
    'notes-and-assets',
    'coordinates',
  ],
  presentation: [
    'all-text-in-order',
    'table-grid',
    'notes-and-assets',
    'coordinates',
    'slide-identity-and-order',
    'slide-boundaries',
    'slide-note-ownership',
  ],
  'spreadsheet-grade': [
    'sheet-identity-and-order',
    'occupied-ranges',
    'all-text-in-order',
    'formulas-and-merges',
    'coordinates',
  ],
  'csv-table': ['logical-matrix', 'columns', 'row-bounds', 'deterministic-diagnostics'],
  'pdf-page': [
    'page-count-and-order',
    'page-content',
    'page-block-coordinates',
    'page-metadata',
    'deterministic-diagnostics',
  ],
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
      errors.push(
        `fixture "${fixture.id}" declares format "${fixture.declaredFormat}" but actual format "${fixture.actualFormat}" without the "mislabeled" feature tag.`,
      )
    }

    if (
      fixture.actualFormat !== fixture.declaredFormat &&
      fixture.tags.includes('mislabeled') &&
      (fixture.expectedOutcome.kind !== 'failure' || fixture.expectedOutcome.error === undefined)
    ) {
      errors.push(`fixture "${fixture.id}" is mislabeled but does not fail closed with a typed error.`)
    }

    if (
      fixture.availability === 'missing' &&
      (fixture.source.kind !== 'missing' || fixture.source.reason.length === 0)
    ) {
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

    if (
      fixture.availability === 'available' &&
      fixture.source.kind === 'file' &&
      !/^[a-f0-9]{64}$/.test(fixture.source.sha256)
    ) {
      errors.push(`fixture "${fixture.id}" has an invalid SHA-256 source hash.`)
    }

    if (fixture.source.kind === 'file' && fixture.source.provenance.reference.length === 0) {
      errors.push(`fixture "${fixture.id}" has no generator or project-fixture reference.`)
    }

    if (fixture.tags.includes('expansion-heavy') && fixture.expectedOutcome.error !== 'expanded-too-large') {
      errors.push(`fixture "${fixture.id}" is expansion-heavy without the "expanded-too-large" outcome.`)
    }

    if (fixture.tags.includes('external-link') && fixture.expectedOutcome.diagnostic !== 'external-resource-blocked') {
      errors.push(`fixture "${fixture.id}" has an external link without the network-denial diagnostic.`)
    }

    const requiredFacts = REQUIRED_FACTS[fixture.useCase]
    if (!sameFacts(fixture.requiredFacts, requiredFacts)) {
      errors.push(`fixture "${fixture.id}" use case "${fixture.useCase}" requires facts "${requiredFacts.join(', ')}".`)
    }

    for (const [resource, ceiling] of Object.entries(ANydocFixtureResourceCeilings) as [
      keyof typeof ANydocFixtureResourceCeilings,
      number,
    ][]) {
      if (!Number.isSafeInteger(fixture.limits[resource]) || fixture.limits[resource] <= 0) {
        errors.push(`fixture "${fixture.id}" limit "${resource}" must be a positive finite integer.`)
      }
      if (fixture.limits[resource] > ceiling) {
        errors.push(`fixture "${fixture.id}" limit "${resource}" exceeds the global ceiling of ${ceiling}.`)
      }
    }

    if (fixture.id.length === 0 || (fixture.source.kind === 'file' && fixture.source.path.length === 0)) {
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
const missing = (reason: string, reference: string): FixtureSource => ({
  kind: 'missing',
  reason,
  provenance: {
    kind: 'unavailable-source',
    reference,
    license: { kind: 'project-owned' },
  },
})

export const fixtureManifests: readonly AnydocFixtureManifest[] = [
  availableFixture(
    'docx-structure-v1',
    'docx',
    'prose',
    'fixtures/prose.docx',
    '5766439b78597e77a28ebf41562ed2375edff1cf6de84eea22590ab73ce1a9fd',
    6499,
    ['anydoc', 'mammoth'],
    undefined,
    ['footnote', 'embedded-image'],
  ),
  availableFixture(
    'doc-legacy-v1',
    'doc',
    'prose',
    'fixtures/prose.doc',
    '43d7f00b1bd7d0784b20245176327690137891a6e65577ca0f2e2dbb3ab9b1c1',
    11264,
    ['anydoc'],
  ),
  missingFixture(
    'docm-macro-v1',
    'docm',
    'prose',
    'A macro-enabled OOXML shell without a valid VBA CFB project is not representative; a valid inert VBA project remains unavailable.',
    'packages/ingest/evals/anydoc/FIXTURES.md#explicitly-unavailable-cases',
  ),
  availableFixture(
    'rtf-prose-v1',
    'rtf',
    'prose',
    'fixtures/prose.rtf',
    '1be57882b7e295a39e752d865ae228315d804c165d8eead8e6f6e0b2ca9596d3',
    6230,
    ['anydoc'],
  ),
  availableFixture(
    'odt-prose-v1',
    'odt',
    'prose',
    'fixtures/prose.odt',
    '96446747eee321ec556b3cb3633d24158014c455d0e0a05bb1a6e24b0a19482b',
    9982,
    ['anydoc'],
  ),
  availableFixture(
    'epub-prose-v1',
    'epub',
    'prose',
    'fixtures/prose.epub',
    '2a53090553242888578e45e11472ff6010ef508afc9c2edce4003a35ffda7fab',
    2961,
    ['anydoc'],
  ),
  availableFixture(
    'pptx-structure-v1',
    'pptx',
    'presentation',
    'fixtures/slides.pptx',
    'a41f60064fc760ee95fa78d0217a672f504f3d12a6da7435775e7666c497f80e',
    17421,
    ['anydoc'],
    undefined,
    ['ordered-slides', 'slide-notes', 'table', 'embedded-image'],
  ),
  missingFixture(
    'ppt-legacy-v1',
    'ppt',
    'presentation',
    'No redistribution-safe legacy presentation fixture is checked in.',
    'docs/superpowers/specs/2026-08-08-anydoc-ingestion-evaluation-design.md#bounded-evaluation',
  ),
  availableFixture(
    'xls-spreadsheet-v1',
    'xls',
    'spreadsheet-grade',
    'fixtures/sheet.xls',
    '89716212ee3279cdbda34421da01242df7917e09a624f80f116181514faa6975',
    4096,
    ['anydoc'],
    undefined,
    ['ordered-sheets', 'merged-cells'],
  ),
  availableFixture(
    'ods-spreadsheet-v1',
    'ods',
    'spreadsheet-grade',
    'fixtures/sheet.ods',
    '27a0636ae8b699921d9ce14e9f2df5e272c5648408a688804eacf0ba11c0152e',
    2779,
    ['anydoc'],
    undefined,
    ['ordered-sheets', 'formula', 'merged-cells'],
  ),
  availableFixture(
    'csv-control-v1',
    'csv',
    'csv-table',
    'fixtures/csv-control-v1.csv',
    '416a2ff58e53cb4196bff8bbd9c67ec4253788f2e86fca317628b15e092b02e5',
    45,
    ['csv-parse'],
  ),
  availableFixture(
    'xlsx-control-v1',
    'xlsx',
    'spreadsheet-grade',
    'fixtures/sheet.xlsx',
    '3eab7f712ee5bc6f00d044040afb79f0fe9d885e1cf47a7a1d89aa445b7a113c',
    6434,
    ['anydoc', 'exceljs'],
    ['exceljs'],
  ),
  availableFixture(
    'pdf-control-v1',
    'pdf',
    'pdf-page',
    '../../__tests__/fixtures/layout-aware-mixed.pdf',
    'e4e51f0e57540b08b28b5379f6bfa4d32ec2097fe5490b7fe1133638756f0924',
    36444,
    ['pdf-inspector'],
    ['pdf-inspector'],
  ),
  missingFixture(
    'encrypted-v1',
    'docx',
    'prose',
    'The available ZIP-password wrapper is not Office document encryption; genuine encrypted Office bytes remain unavailable.',
    'packages/ingest/evals/anydoc/generate-fixtures.mjs',
    ['encrypted'],
  ),
  hostileFixture(
    'truncated-v1',
    'fixtures/truncated.docx',
    '64f765c7aa8e2e5f4f4a7c90d1cc2b7afcaa29bea87493a490ff5b5e75ad9b58',
    32,
    ['truncated'],
    'invalid-result',
  ),
  hostileFixture(
    'malformed-v1',
    'fixtures/malformed.docx',
    '76b88821421dc40df237bee3a69fecd76003240e5bac3fe31b5f5cedc700e90f',
    18,
    ['malformed'],
    'invalid-result',
  ),
  {
    ...availableFixture(
      'mislabeled-v1',
      'docx',
      'prose',
      'fixtures/mislabeled.docx',
      'ed7e13db986967d27375e3aa61e6984c45449d3d6da69f573031a1fa3a375556',
      76,
      ['anydoc'],
    ),
    actualFormat: 'rtf',
    expectedOutcome: { kind: 'failure', error: 'invalid-result' },
    tags: ['mislabeled'],
  },
  {
    ...hostileFixture(
      'expansion-heavy-v1',
      'fixtures/expansion-heavy.docx',
      'f545dc2f93f8df769547a78a23cf54cc0f5c35bb8c591876ed7708c48c64e970',
      2150,
      ['expansion-heavy'],
      'expanded-too-large',
    ),
    limits: { ...limits, expandedBytes: 1024 },
  },
  {
    ...availableFixture(
      'external-link-v1',
      'docx',
      'prose',
      'fixtures/external-link.docx',
      'edd3f32d7f4ac15858e566362604802a92bd5f73042c24c47e778c32a4e92574',
      6525,
      ['anydoc'],
      undefined,
      ['external-relationship'],
    ),
    expectedOutcome: { kind: 'success', diagnostic: 'external-resource-blocked' },
    tags: ['external-link'],
  },
  missingFixture(
    'timeout-v1',
    'docx',
    'prose',
    'Runner-only deterministic recipe requires a wall-time limit and is not a static parser input.',
    'packages/ingest/evals/anydoc/generate-fixtures.mjs',
  ),
  missingFixture(
    'memory-limit-v1',
    'docx',
    'prose',
    'Runner-only deterministic recipe requires verified containment and is not a static parser input.',
    'packages/ingest/evals/anydoc/generate-fixtures.mjs',
  ),
  missingFixture(
    'containment-unavailable-v1',
    'docx',
    'prose',
    'Runner-only deterministic recipe tests absent host containment before Anydoc loads.',
    'packages/ingest/evals/anydoc/generate-fixtures.mjs',
  ),
]

function availableFixture(
  id: string,
  format: FixtureFormat,
  useCase: FixtureUseCase,
  path: string,
  sha256: string,
  byteLength: number,
  candidates: readonly string[],
  controls?: readonly string[],
  inspectedFacts: readonly InspectedFact[] = [],
): AnydocFixtureManifest {
  const generated = path !== 'fixtures/csv-control-v1.csv' && !path.includes('__tests__')
  return {
    id,
    availability: 'available',
    source: {
      kind: 'file',
      path,
      sha256,
      byteLength,
      license: { kind: 'project-owned' },
      provenance: generated
        ? {
            kind: 'generator-recipe',
            reference: 'packages/ingest/evals/anydoc/generate-fixtures.mjs',
            license: { kind: 'project-owned' },
          }
        : { kind: 'project-fixture', reference: path, license: { kind: 'project-owned' } },
    },
    declaredFormat: format,
    actualFormat: format,
    useCase,
    requiredFacts: REQUIRED_FACTS[useCase],
    parserApplicability: { candidates, controls },
    expectedOutcome: { kind: 'success' },
    tags: ['control'],
    inspectedFacts,
    limits,
  }
}

function hostileFixture(
  id: string,
  path: string,
  sha256: string,
  byteLength: number,
  tags: readonly FixtureTag[],
  error: NonNullable<FixtureExpectedOutcome['error']>,
): AnydocFixtureManifest {
  return {
    ...availableFixture(id, 'docx', 'prose', path, sha256, byteLength, ['anydoc']),
    expectedOutcome: { kind: 'failure', error },
    tags,
  }
}

function missingFixture(
  id: string,
  format: FixtureFormat,
  useCase: FixtureUseCase,
  reason: string,
  reference: string,
  tags: readonly FixtureTag[] = [],
  actualFormat = format,
): AnydocFixtureManifest {
  return {
    id,
    availability: 'missing',
    source: missing(reason, reference),
    declaredFormat: format,
    actualFormat,
    useCase,
    requiredFacts: REQUIRED_FACTS[useCase],
    parserApplicability: { candidates: ['anydoc'] },
    expectedOutcome: { kind: 'missing' },
    tags,
    inspectedFacts: [],
    limits,
  }
}
