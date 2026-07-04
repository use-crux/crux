import { readdir, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CruxGraphRecordBatchSchema,
} from '../../observability'

const fixturesDir = new URL('../../observability/fixtures/', import.meta.url)
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
})

async function readFixtureBatches(): Promise<
  readonly { readonly name: string; readonly batch: RawFixtureBatch }[]
> {
  const files = (await readdir(fixturesDir))
    .filter((file) => file.endsWith('.json') && file !== 'taxonomy.json')
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

interface TaxonomyFixture {
  readonly primitiveFamilies: Readonly<Record<string, string>>
  readonly artifactKinds: readonly string[]
  readonly edgeTypes: readonly string[]
}
