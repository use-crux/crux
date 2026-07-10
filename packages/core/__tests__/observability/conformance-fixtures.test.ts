import { readdir, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CruxGraphRecordBatchSchema,
  CruxGraphRecordSchema,
} from '../../src/observability'

const fixturesDir = new URL('../../src/observability/fixtures/', import.meta.url)
const FutureLifecycleBaseEnvelopeSchema = z.object({
  schemaVersion: z.literal(CRUX_OBSERVABILITY_SCHEMA_VERSION),
  recordId: z.string().min(1),
  runId: z.string().min(1),
  segmentId: z.string().min(1),
  segmentSeq: z.number().int().positive(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  traceId: z.string().optional(),
})
const producerRecordTypes = [
  'run:start',
  'run:end',
  'span:start',
  'span:end',
  'span',
  'span:event',
  'artifact',
  'edge',
] as const

interface RawFixtureBatch {
  readonly records?: readonly { readonly type?: string }[]
}

describe('observability conformance fixture corpus', () => {
  it('keeps every producer fixture valid and covers every graph record type', async () => {
    const fixtures = await readFixtureBatches()
    const producerFixtures = fixtures.filter(
      (fixture) => !fixture.name.startsWith('forward-'),
    )
    const coveredTypes = new Set<string>()

    for (const fixture of producerFixtures) {
      const parsed = CruxGraphRecordBatchSchema.safeParse(fixture.batch)
      expect(
        parsed.success,
        `${fixture.name} should match the producer schema`,
      ).toBe(true)
      if (parsed.success) {
        for (const record of parsed.data.records) coveredTypes.add(record.type)
      }
    }

    expect([...coveredTypes].sort()).toEqual([...producerRecordTypes].sort())
  })

  it('documents forward-compatible consumer samples without widening the producer schema', async () => {
    const fixtures = await readFixtureBatches()
    const unknownTypeFixture = fixtures.find(
      (fixture) => fixture.name === 'forward-unknown-record.json',
    )
    const extraFieldsFixture = fixtures.find(
      (fixture) => fixture.name === 'forward-extra-fields.json',
    )

    expect(unknownTypeFixture).toBeDefined()
    expect(extraFieldsFixture).toBeDefined()

    expect(
      CruxGraphRecordBatchSchema.safeParse(unknownTypeFixture?.batch).success,
    ).toBe(false)
    expect(
      CruxGraphRecordBatchSchema.safeParse(extraFieldsFixture?.batch).success,
    ).toBe(true)
  })

  it('keeps the shared taxonomy fixture synchronized with the TypeScript contract', async () => {
    const taxonomy = JSON.parse(
      await readFile(new URL('taxonomy.json', fixturesDir), 'utf8'),
    ) as TaxonomyFixture

    expect(taxonomy).toEqual({
      primitiveFamilies: Object.fromEntries(
        Object.entries(CRUX_PRIMITIVE_FAMILY_BY_NAME).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      artifactKinds: [...CRUX_CANONICAL_ARTIFACT_KINDS].sort(),
      edgeTypes: [...CRUX_CANONICAL_EDGE_TYPES].sort(),
    })
  })

  it('validates every shared v2 contract fixture with segment-local identity', async () => {
    const corpus = JSON.parse(
      await readFile(new URL('v2-contract-cases.json', fixturesDir), 'utf8'),
    ) as V2ContractCorpus

    expect(corpus.cases.map((testCase) => testCase.name)).toEqual([
      'one-segment-success',
      'one-segment-error',
      'one-segment-cancelled',
      'suspend-resume-fresh-process',
      'concurrent-segments',
      'child-before-parent-and-terminal-before-start',
      'duplicate-identical-and-conflicting-record-id',
      'pre-v2-local-store-migration-reset',
      'missing-parent-segment-gap',
      'crash-incomplete-distinct-from-suspend-and-terminal',
    ])

    const phase3BaseEnvelopeOnly = new Set([
      'suspend-resume-fresh-process',
      'concurrent-segments',
      'crash-incomplete-distinct-from-suspend-and-terminal',
    ])

    for (const testCase of corpus.cases) {
      const normalized = testCase.records.map((record) => {
        // Phase 3 owns lifecycle record behavior; Phase 1 only proves that
        // future records carry the v2 base envelope without widening the
        // current graph-record union.
        const decoded = phase3BaseEnvelopeOnly.has(testCase.name)
          ? FutureLifecycleBaseEnvelopeSchema.parse(record)
          : CruxGraphRecordSchema.parse(record)
        return {
          recordId: decoded.recordId,
          schemaVersion: decoded.schemaVersion,
          segmentId: decoded.segmentId,
          segmentSeq: decoded.segmentSeq,
        }
      })
      expect(normalized, testCase.name).toEqual(testCase.expected)
    }

    const futureLifecycleRecords = corpus.cases
      .flatMap((testCase) => testCase.records)
      .filter((record) =>
        ['run:suspend', 'run:resume'].includes(
          (record as { readonly type?: string }).type ?? '',
        ),
      )
    expect(futureLifecycleRecords.length).toBeGreaterThan(0)
    for (const record of futureLifecycleRecords) {
      expect(CruxGraphRecordSchema.safeParse(record).success).toBe(false)
    }
  })
})

async function readFixtureBatches(): Promise<
  readonly { readonly name: string; readonly batch: RawFixtureBatch }[]
> {
  const files = (await readdir(fixturesDir))
    .filter(
      (file) =>
        file.endsWith('.json') &&
        file !== 'taxonomy.json' &&
        file !== 'v2-contract-cases.json',
    )
    .sort()
  return Promise.all(
    files.map(async (file) => ({
      name: basename(file),
      batch: JSON.parse(
        await readFile(new URL(file, fixturesDir), 'utf8'),
      ) as RawFixtureBatch,
    })),
  )
}

interface V2ContractCorpus {
  readonly cases: readonly V2ContractCase[]
}

interface V2ContractCase {
  readonly name: string
  readonly records: readonly {
    readonly recordId: string
    readonly type?: string
  }[]
  readonly expected: readonly {
    readonly recordId: string
    readonly schemaVersion: 2
    readonly segmentId: string
    readonly segmentSeq: number
  }[]
}

interface TaxonomyFixture {
  readonly primitiveFamilies: Readonly<Record<string, string>>
  readonly artifactKinds: readonly string[]
  readonly edgeTypes: readonly string[]
}
