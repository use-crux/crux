import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { collectImportBindings } from './ast/imports'
import { createSourceFile } from './ast/parse'
import { cacheFileForIdentity, sha256, STATIC_PARSE_CACHE_EPOCH } from './cache-identity'
import { indexCacheBoundaryFileNames } from './incremental/boundaries'
import { parseStaticDefinitionsFromFacts } from './static-file'
import type { StaticFactParser, StaticParseResult } from './types'

/** Uses the filesystem cache as an effectful shell around deterministic fact-first static parsing. */
export async function parseStaticDefinitionsFromFactsCached(
  root: string,
  file: string,
  parser: StaticFactParser,
): Promise<StaticParseResult> {
  const cacheInput = await cacheKeyInput(root, file, parser)
  if (!cacheInput) return parseStaticDefinitionsFromFacts(root, file, parser)

  const cacheFile = cacheFileForIdentity(root, STATIC_PARSE_CACHE_EPOCH, cacheInput)
  const cached = await readCache(cacheFile)
  if (cached) return cached

  const parsed = await parseStaticDefinitionsFromFacts(root, file, parser)
  await writeCache(cacheFile, parsed)
  return parsed
}

/** Builds the complete invalidation key for a source file, returning undefined to force uncached parsing when unsafe. */
async function cacheKeyInput(
  root: string,
  file: string,
  parser: StaticFactParser,
): Promise<
  | {
      version: string
      root: string
      file: string
      sourceHash: string
      dependencies: Array<{ file: string; sourceHash: string }>
      configFiles: Array<{ file: string; sourceHash: string }>
      compilerInputs: readonly unknown[]
    }
  | undefined
> {
  try {
    const source = await readFile(file, 'utf8')
    const sourceFile = createSourceFile(file, source)
    const dependencyFiles = [
      ...new Set([...collectImportBindings(sourceFile, root, file).values()].map((binding) => binding.file)),
    ].sort()
    const dependencies = []
    for (const dependencyFile of dependencyFiles) {
      const dependencySource = await readFile(dependencyFile, 'utf8')
      dependencies.push({
        file: relative(root, dependencyFile).replace(/\\/g, '/'),
        sourceHash: sha256(dependencySource),
      })
    }
    const configFiles = await configFileHashes(root)
    return {
      version: STATIC_PARSE_CACHE_EPOCH,
      root,
      file: relative(root, file).replace(/\\/g, '/'),
      sourceHash: sha256(source),
      dependencies,
      configFiles,
      compilerInputs: parser.staticCacheInputs ?? [],
    }
  } catch {
    return undefined
  }
}

/** Captures project-level compiler boundary files that can change parser output without editing the source file. */
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

/** Accepts cached data only when it has the minimum index projection shape required by callers. */
async function readCache(file: string): Promise<StaticParseResult | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    return isStaticParseResult(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Persists cache data best-effort so cache filesystem failures never change indexing correctness. */
async function writeCache(file: string, result: StaticParseResult): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(result), 'utf8')
  } catch {
    // Cache writes are best effort. Index indexing must never fail because
    // the local cache is unavailable or read-only.
  }
}

/** Performs the shallow cache validation needed before trusting JSON from disk. */
function isStaticParseResult(value: unknown): value is StaticParseResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StaticParseResult>
  return (
    Array.isArray(candidate.definitions) &&
    Array.isArray(candidate.relations) &&
    Array.isArray(candidate.dependencies) &&
    Array.isArray(candidate.diagnostics)
  )
}
