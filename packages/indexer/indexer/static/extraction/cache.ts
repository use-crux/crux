import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { cacheFileForIdentity, STATIC_PARSE_CACHE_EPOCH } from '../../cache-identity'
import { mapBounded } from '../../pipeline'
import type { StaticParseResult } from '../types'
import type {
  StaticFileExtraction,
  StaticParseCacheEntryMetadata,
  StaticParseCacheHit,
  StaticParseCacheSourceHash,
  StaticParseCacheStore,
} from './types'
import { createStaticParseCacheKeyContext } from './cache-key'
import { createSourceHashMemo, type SourceHashMemo } from './source-hash-memo'
export { cacheKeyInput, cacheKeyInputFromSyntaxRecord, createStaticParseCacheKeyContext } from './cache-key'

interface StaticParseCacheManifestEntry extends StaticParseCacheEntryMetadata {
  readonly cacheKey: string
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
    set: async (key: string, value: StaticFileExtraction, metadata?: StaticParseCacheEntryMetadata) => {
      await writeCache(cacheFileForIdentity(root, STATIC_PARSE_CACHE_EPOCH, key), value)
      if (metadata) await writeCacheManifestEntry(root, key, metadata)
    },
  })
}

/**
 * Reads the static parse cache manifest for a native parser plan.
 *
 * The manifest is conservative: missing entries, changed source hashes, changed
 * dependency hashes, changed config boundary files, or unreadable cache entries
 * are all misses. It avoids TypeScript parsing during native planning while
 * validating the exact evidence captured by the previous cache-key computation.
 */
export async function staticParseCacheManifestStatus(input: {
  readonly root: string
  readonly files: readonly string[]
  readonly compilerInputs: readonly unknown[]
}): Promise<{
  readonly cacheHits: readonly string[]
  readonly cacheMisses: readonly string[]
  readonly cacheEntries: readonly StaticParseCacheHit[]
}> {
  const cache = persistentStaticParseCache(input.root)
  const keyContext = createStaticParseCacheKeyContext(input.root)
  const currentConfigFiles = await keyContext.configFiles()
  const entriesByIdentity = await readCacheManifestEntries(input.root)
  const sourceHashes = createSourceHashMemo()
  const statuses = await mapBounded(input.files, 32, async (file) => ({
    file,
    entry: await staticParseCacheManifestHit({
      root: input.root,
      file,
      compilerInputs: input.compilerInputs,
      currentConfigFiles,
      cache,
      entriesByIdentity,
      sourceHashes,
    }),
  }))
  return {
    cacheHits: statuses.filter((status) => status.entry).map((status) => status.file),
    cacheMisses: statuses.filter((status) => !status.entry).map((status) => status.file),
    cacheEntries: statuses.flatMap((status) =>
      status.entry ? [{ file: status.file, cacheKey: status.entry.cacheKey }] : [],
    ),
  }
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

async function staticParseCacheManifestHit(input: {
  readonly root: string
  readonly file: string
  readonly compilerInputs: readonly unknown[]
  readonly currentConfigFiles: readonly StaticParseCacheSourceHash[]
  readonly cache: StaticParseCacheStore
  readonly entriesByIdentity: ReadonlyMap<string, StaticParseCacheManifestEntry>
  readonly sourceHashes: SourceHashMemo
}): Promise<StaticParseCacheManifestEntry | undefined> {
  try {
    const entry = input.entriesByIdentity.get(cacheManifestIdentity(input.root, input.file, input.compilerInputs))
    if (!entry) return undefined
    if (entry.sourceHash !== (await input.sourceHashes.read(input.file))) return undefined
    if (!sourceHashesEqual(entry.configFiles, input.currentConfigFiles)) return undefined
    for (const dependency of entry.dependencies) {
      if (dependency.sourceHash !== (await input.sourceHashes.read(join(input.root, dependency.file)))) {
        return undefined
      }
    }
    return (await input.cache.get(entry.cacheKey)) ? entry : undefined
  } catch {
    return undefined
  }
}

async function writeCacheManifestEntry(
  root: string,
  cacheKey: string,
  metadata: StaticParseCacheEntryMetadata,
): Promise<void> {
  try {
    const file = cacheManifestLogFile(root)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify({ ...metadata, cacheKey })}\n`, 'utf8')
  } catch {
    // Cache manifests are best effort. Indexing must never fail because manifest IO failed.
  }
}

async function readCacheManifestEntries(root: string): Promise<ReadonlyMap<string, StaticParseCacheManifestEntry>> {
  const entriesByIdentity = new Map<string, StaticParseCacheManifestEntry>()
  try {
    const lines = (await readFile(cacheManifestLogFile(root), 'utf8')).split('\n')
    for (const line of lines) {
      if (line.trim().length === 0) continue
      const parsed = JSON.parse(line) as unknown
      if (!isStaticParseCacheManifestEntry(parsed)) continue
      entriesByIdentity.set(cacheManifestIdentity(root, parsed.file, parsed.compilerInputs), parsed)
    }
  } catch {
    // Missing or unreadable manifests simply produce all misses.
  }
  return entriesByIdentity
}

function cacheManifestLogFile(root: string): string {
  return join(root, '.crux', 'cache', 'index', STATIC_PARSE_CACHE_EPOCH, 'manifest.jsonl')
}

function cacheManifestIdentity(root: string, file: string, compilerInputs: readonly unknown[]): string {
  const relativeFile = file.startsWith(root) ? relative(root, file).replace(/\\/g, '/') : file
  return JSON.stringify({ version: STATIC_PARSE_CACHE_EPOCH, root, file: relativeFile, compilerInputs })
}

function sourceHashesEqual(
  left: readonly StaticParseCacheSourceHash[],
  right: readonly StaticParseCacheSourceHash[],
): boolean {
  return JSON.stringify([...left].sort(compareSourceHash)) === JSON.stringify([...right].sort(compareSourceHash))
}

function compareSourceHash(left: StaticParseCacheSourceHash, right: StaticParseCacheSourceHash): number {
  return left.file.localeCompare(right.file)
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

function isStaticParseCacheManifestEntry(value: unknown): value is StaticParseCacheManifestEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StaticParseCacheManifestEntry>
  return (
    candidate.version === STATIC_PARSE_CACHE_EPOCH &&
    typeof candidate.root === 'string' &&
    typeof candidate.file === 'string' &&
    typeof candidate.sourceHash === 'string' &&
    typeof candidate.cacheKey === 'string' &&
    Array.isArray(candidate.dependencies) &&
    Array.isArray(candidate.configFiles) &&
    Array.isArray(candidate.compilerInputs)
  )
}
