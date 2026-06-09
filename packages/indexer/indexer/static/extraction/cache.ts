import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { collectImportBindings } from '../../ast/imports'
import { cacheFileForIdentity, sha256, STATIC_PARSE_CACHE_EPOCH } from '../../cache-identity'
import { indexCacheBoundaryFileNames } from '../../incremental/boundaries'
import type { StaticParseResult } from '../types'
import type { StaticFileExtraction, StaticParseCacheStore } from './engine'
import type { ParseMemo } from './source-io'

/**
 * Computes the cache lookup input for one static file extraction.
 *
 * The result is intentionally a plain JSON value. The persistent cache hashes it into a filename,
 * while tests and custom stores can inspect it as data. When any required source/config read fails,
 * the function returns `undefined`; extraction should continue uncached rather than letting cache IO
 * affect indexing correctness.
 */
export async function cacheKeyInput(input: {
  readonly root: string
  readonly file: string
  readonly parseMemo: ParseMemo
  readonly compilerInputs: readonly unknown[]
}): Promise<unknown | undefined> {
  try {
    const source = await input.parseMemo.readSource(input.file)
    const sourceFile = await input.parseMemo.readSourceFile(input.file)
    const dependencyFiles = [
      ...new Set(
        [...collectImportBindings(sourceFile, input.root, input.file).values()].map((binding) => binding.file),
      ),
    ].sort()
    const dependencies = []
    for (const dependencyFile of dependencyFiles) {
      dependencies.push({
        file: relative(input.root, dependencyFile).replace(/\\/g, '/'),
        sourceHash: sha256(await input.parseMemo.readSource(dependencyFile)),
      })
    }
    return {
      version: STATIC_PARSE_CACHE_EPOCH,
      root: input.root,
      file: relative(input.root, input.file).replace(/\\/g, '/'),
      sourceHash: sha256(source),
      dependencies,
      configFiles: await configFileHashes(input.root),
      compilerInputs: input.compilerInputs,
    }
  } catch {
    return undefined
  }
}

/**
 * Uses the project-local `.crux/cache/index` directory for static extraction results.
 *
 * Filesystem failures are treated as cache misses/writes that did not stick. The cache must improve
 * speed, never change indexing behavior.
 */
export function persistentStaticParseCache(root: string): StaticParseCacheStore {
  return Object.freeze({
    get: async (key: string) => readCache(cacheFileForIdentity(root, STATIC_PARSE_CACHE_EPOCH, key)),
    set: async (key: string, value: StaticFileExtraction) =>
      writeCache(cacheFileForIdentity(root, STATIC_PARSE_CACHE_EPOCH, key), value),
  })
}

/**
 * Creates a cache store that never returns or persists values.
 *
 * Tests and tools use this to exercise the production extraction path without coupling assertions to
 * filesystem cache state.
 */
export function noStaticParseCache(): StaticParseCacheStore {
  return Object.freeze({
    get: async () => undefined,
    set: async () => undefined,
  })
}

/**
 * Reads cache-boundary config files and returns content hashes for the files that exist.
 *
 * Static extraction can depend on configuration even when source text is unchanged, for example when
 * path aliases change import resolution. Missing config files are represented by absence so creating
 * one later naturally changes the cache key.
 */
async function configFileHashes(root: string): Promise<Array<{ file: string; sourceHash: string }>> {
  const configFiles = []
  for (const name of indexCacheBoundaryFileNames) {
    const file = join(root, name)
    try {
      configFiles.push({ file: name, sourceHash: sha256(await readFile(file, 'utf8')) })
    } catch {
      // Missing config files are represented by absence.
    }
  }
  return configFiles
}

/**
 * Reads and validates one persistent static extraction cache entry.
 *
 * Invalid JSON or stale shapes are treated as misses. The returned value is tagged with
 * `fromCache: true` so callers can explain cache behavior without changing the serialized payload.
 */
async function readCache(file: string): Promise<StaticFileExtraction | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    return isStaticFileExtraction(parsed) ? { ...parsed, fromCache: true } : undefined
  } catch {
    return undefined
  }
}

/**
 * Persists one static extraction result as JSON.
 *
 * `fromCache` is intentionally omitted from the stored value because it describes how the current run
 * obtained the result, not the facts themselves.
 */
async function writeCache(file: string, result: StaticFileExtraction): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    const { fromCache: _fromCache, ...cacheable } = result
    await writeFile(file, JSON.stringify(cacheable), 'utf8')
  } catch {
    // Cache writes are best effort. Indexing must never fail because the local cache is unavailable.
  }
}

/**
 * Performs a lightweight structural check before accepting cache JSON.
 *
 * The persistent cache is an optimization, not trusted input. A shallow shape check is enough to keep
 * obviously incompatible entries out while avoiding a second schema system for internal cache files.
 */
function isStaticFileExtraction(value: unknown): value is StaticFileExtraction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StaticParseResult>
  return (
    Array.isArray(candidate.definitions) &&
    Array.isArray(candidate.relations) &&
    Array.isArray(candidate.dependencies) &&
    Array.isArray(candidate.diagnostics)
  )
}
