import { join } from 'node:path'
import { createExtensionRegistry } from './indexer/extensions'
import type { IndexDependency, IndexerExtension } from './extensions'
import type { ProjectIndexCompilerProfile } from './indexer/compiler/profile'
import { createStaticExtraction, type StaticFileExtraction, type SourceReader } from './indexer/static/extraction/engine'

/**
 * A source-text fixture for an indexer extension.
 *
 * Fixtures are the recommended way to test extension behavior. They run the real static extraction
 * engine against in-memory source files, so tests cover parser dispatch, import-aware pattern
 * matching, readers, builders, relation projection, diagnostics, and cache identity without
 * constructing parser-native contexts.
 *
 * The fixture compiler profile is intentionally empty. Only the extension under test participates
 * in extraction, which keeps assertions focused and prevents first-party Crux extractors from
 * masking extension behavior.
 */
export interface IndexerExtensionFixture {
  /** Extension manifest under test. It is validated before extraction starts. */
  readonly extension: IndexerExtension
  /** Additional absolute files available to the in-memory source reader. */
  readonly files: Readonly<Record<string, string>>
}

/**
 * Source-text extraction result for an extension fixture.
 *
 * The shape mirrors production `StaticFileExtraction` for the fields extension authors usually
 * assert. The `trace` block carries compiler details that are useful when a test needs to prove
 * dependency discovery or cache-input stability.
 */
export interface FixtureExtraction {
  /** Convenience grouping for tests that want to assert "facts out" as one value. */
  readonly facts: {
    readonly definitions: StaticFileExtraction['definitions']
    readonly relations: StaticFileExtraction['relations']
  }
  /** Definitions emitted by the extension and projected by the engine. */
  readonly definitions: StaticFileExtraction['definitions']
  /** Relations emitted or resolved during fixture extraction. */
  readonly relations: StaticFileExtraction['relations']
  /** Diagnostics emitted by the extension or static projection pipeline. */
  readonly diagnostics: StaticFileExtraction['diagnostics']
  /** File, dependency, and identity details for deterministic fixture assertions. */
  readonly trace: {
    readonly file: string
    readonly dependencies: StaticFileExtraction['dependencies']
    readonly cacheInputs: readonly IndexDependency[]
  }
}

/**
 * Prepares an extension for source-text extraction tests.
 *
 * Use this once per extension under test, then pass the fixture to `extractFixtureSource(...)`.
 * Additional `files` are useful for import graphs, such as `import { schema } from './schema'`.
 *
 * @example
 * ```ts
 * const fixture = defineIndexerExtensionFixture(extension)
 * ```
 */
export function defineIndexerExtensionFixture(
  extension: IndexerExtension,
  options: { readonly files?: Readonly<Record<string, string>> } = {},
): IndexerExtensionFixture {
  return { extension, files: options.files ?? {} }
}

/**
 * Validates a fixture manifest without reading source.
 *
 * This is useful for tests that assert declaration failures: duplicate relation specs, invalid rule
 * metadata, unsupported compatibility ranges, or malformed extractor patterns.
 */
export function validateIndexerExtensionFixture(fixture: IndexerExtensionFixture): void {
  createExtensionRegistry([fixture.extension])
}

/**
 * Runs one source fixture through the same static extraction path as production.
 *
 * Pass a string for the common case where the source file name does not matter. Pass `{ file,
 * source }` when path-sensitive behavior matters, such as import resolution or source references.
 *
 * The fixture engine disables cache and uses an in-memory source reader. That keeps tests fast and
 * deterministic while still covering the real parser, registry, runtime context, and projection
 * code.
 *
 * @example
 * ```ts
 * const out = await extractFixtureSource(
 *   defineIndexerExtensionFixture(extension),
 *   `export const workflow = defineWorkflow({ id: 'release' })`,
 * )
 *
 * expect(out.definitions[0]?.id).toBe('@acme.workflow:release')
 * ```
 */
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

/**
 * Verifies that an extension fixture produces stable output.
 *
 * The assertion runs the same fixture twice and compares canonical JSON output. It is intentionally
 * strict: failures usually mean an extractor retained mutable state, depended on unordered object
 * traversal, read ambient process state, or introduced clock/randomness into emitted facts.
 */
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

/**
 * Creates the in-memory source reader used by extension fixtures.
 *
 * The reader fails loudly for missing files so fixture tests expose broken import paths instead of
 * silently falling back to the host filesystem.
 */
function inMemorySourceReader(files: Readonly<Record<string, string>>): SourceReader {
  return {
    read: async (file) => {
      const source = files[file]
      if (source === undefined) throw new Error(`Fixture source not found: ${file}`)
      return source
    },
  }
}

/**
 * Serializes fixture output for deterministic comparison.
 *
 * Fixture outputs are constructed in stable order by the extraction engine, so JSON serialization is
 * sufficient and keeps the assertion free of test-runner-specific matchers.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value)
}

const fixtureCompilerProfile = {
  name: '@crux/indexer/fixture-profile',
  version: '1',
  extensions: [],
} as const satisfies ProjectIndexCompilerProfile
