import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'
import { collectImportBindings } from './ast/imports'
import { createSourceFile } from './ast/parse'
import { catalogCacheBoundaryFileNames } from './incremental/boundaries'
import type { CatalogPatchFacts } from './patches'
import { semanticCatalogFacts } from './semantic'

const CACHE_VERSION = 'semantic-facts-v4'
const COMPILER_OPTIONS_VERSION = 'ts-bundler-es2022-strict-false'

export async function semanticCatalogFactsCached(root: string, files: readonly string[]): Promise<CatalogPatchFacts> {
  const cacheInput = await semanticCacheKeyInput(root, files)
  if (!cacheInput) return semanticCatalogFacts(root, files)

  const cacheFile = join(root, '.crux', 'cache', 'catalog', CACHE_VERSION, `${sha256(JSON.stringify(cacheInput))}.json`)
  const cached = await readCache(cacheFile)
  if (cached) return cached

  const facts = semanticCatalogFacts(root, files)
  await writeCache(cacheFile, facts)
  return facts
}

async function semanticCacheKeyInput(
  root: string,
  files: readonly string[],
): Promise<
  | {
      version: string
      typescriptVersion: string
      compilerOptionsVersion: string
      root: string
      files: Array<{ file: string; sourceHash: string }>
      configFiles: Array<{ file: string; sourceHash: string }>
    }
  | undefined
> {
  try {
    const fileInputs = []
    for (const file of await semanticCacheDependencyClosure(root, files)) {
      fileInputs.push({
        file: relative(root, file).replace(/\\/g, '/'),
        sourceHash: sha256(await readFile(file, 'utf8')),
      })
    }

    const configFiles = []
    for (const name of catalogCacheBoundaryFileNames) {
      const file = join(root, name)
      try {
        configFiles.push({
          file: name,
          sourceHash: sha256(await readFile(file, 'utf8')),
        })
      } catch {
        // Missing config files are part of the key by absence.
      }
    }

    return {
      version: CACHE_VERSION,
      typescriptVersion: ts.version,
      compilerOptionsVersion: COMPILER_OPTIONS_VERSION,
      root,
      files: fileInputs,
      configFiles,
    }
  } catch {
    return undefined
  }
}

async function semanticCacheDependencyClosure(root: string, files: readonly string[]): Promise<string[]> {
  const seen = new Set<string>()
  const queue = [...files].sort()
  const maxFiles = 5_000

  while (queue.length > 0 && seen.size < maxFiles) {
    const file = queue.shift()
    if (!file || seen.has(file)) continue
    seen.add(file)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const sourceFile = createSourceFile(file, source)
    for (const dependency of collectImportBindings(sourceFile, root, file).values()) {
      if (!seen.has(dependency.file)) queue.push(dependency.file)
    }
    queue.sort()
  }

  return [...seen].sort()
}

async function readCache(file: string): Promise<CatalogPatchFacts | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    return isCatalogPatchFacts(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function writeCache(file: string, facts: CatalogPatchFacts): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(facts), 'utf8')
  } catch {
    // Semantic cache writes are best effort. Catalog indexing must never fail
    // because local cache storage is unavailable or read-only.
  }
}

function isCatalogPatchFacts(value: unknown): value is CatalogPatchFacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    arrayOrMissing(candidate.definitions) &&
    arrayOrMissing(candidate.relations) &&
    arrayOrMissing(candidate.sourceRefs) &&
    arrayOrMissing(candidate.diagnostics) &&
    arrayOrMissing(candidate.lintFindings) &&
    arrayOrMissing(candidate.sources)
  )
}

function arrayOrMissing(value: unknown): boolean {
  return value === undefined || Array.isArray(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
