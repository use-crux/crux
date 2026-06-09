import { join } from 'node:path'
import { createExtensionRegistry } from './indexer/extensions'
import type { IndexDependency, IndexerExtension } from './extensions'
import type { ProjectIndexCompilerProfile } from './indexer/compiler/profile'
import { createStaticExtraction, type StaticFileExtraction, type SourceReader } from './indexer/static/extraction/engine'

export interface IndexerExtensionFixture {
  readonly extension: IndexerExtension
  readonly files: Readonly<Record<string, string>>
}

export interface FixtureExtraction {
  readonly facts: {
    readonly definitions: StaticFileExtraction['definitions']
    readonly relations: StaticFileExtraction['relations']
  }
  readonly definitions: StaticFileExtraction['definitions']
  readonly relations: StaticFileExtraction['relations']
  readonly diagnostics: StaticFileExtraction['diagnostics']
  readonly trace: {
    readonly file: string
    readonly dependencies: StaticFileExtraction['dependencies']
    readonly cacheInputs: readonly IndexDependency[]
  }
}

export function defineIndexerExtensionFixture(
  extension: IndexerExtension,
  options: { readonly files?: Readonly<Record<string, string>> } = {},
): IndexerExtensionFixture {
  return { extension, files: options.files ?? {} }
}

export function validateIndexerExtensionFixture(fixture: IndexerExtensionFixture): void {
  createExtensionRegistry([fixture.extension])
}

export async function extractFixtureSource(
  fixture: IndexerExtensionFixture,
  input: string | { readonly file: string; readonly source: string },
): Promise<FixtureExtraction> {
  validateIndexerExtensionFixture(fixture)
  const root = '/__crux_indexer_fixture__'
  const file = typeof input === 'string' ? join(root, 'fixture.ts') : join(root, input.file)
  const source = typeof input === 'string' ? input : input.source
  const files = { ...fixture.files, [file]: source }
  const extraction = createStaticExtraction({
    root,
    profile: fixtureCompilerProfile,
    extensions: [fixture.extension],
    sources: inMemorySourceReader(files),
    cache: 'none',
  })
  const extracted = await extraction.extractFile(file)
  return {
    facts: {
      definitions: extracted.definitions,
      relations: extracted.relations,
    },
    definitions: extracted.definitions,
    relations: extracted.relations,
    diagnostics: extracted.diagnostics,
    trace: {
      file: extracted.file,
      dependencies: extracted.dependencies,
      cacheInputs: extraction.identity.cacheInputs,
    },
  }
}

export async function assertDeterministicExtraction(
  fixture: IndexerExtensionFixture,
  source: string,
): Promise<void> {
  const first = await extractFixtureSource(fixture, source)
  const second = await extractFixtureSource(fixture, source)
  if (canonical(first) !== canonical(second)) {
    throw new Error('Indexer extension fixture extraction is not deterministic')
  }
}

function inMemorySourceReader(files: Readonly<Record<string, string>>): SourceReader {
  return {
    read: async (file) => {
      const source = files[file]
      if (source === undefined) throw new Error(`Fixture source not found: ${file}`)
      return source
    },
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value)
}

const fixtureCompilerProfile = {
  name: '@crux/indexer/fixture-profile',
  version: '1',
  extensions: [],
} as const satisfies ProjectIndexCompilerProfile
