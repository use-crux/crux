import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'
import { collectImportBindings } from './ast/imports'
import { createSourceFile } from './ast/parse'
import {
  cacheFileForIdentity,
  SEMANTIC_COMPILER_OPTIONS_ID,
  SEMANTIC_FACTS_CACHE_EPOCH,
  sha256,
} from './cache-identity'
import { indexCacheBoundaryFileNames } from './incremental/boundaries'
import type { IndexPatchFacts } from './patches'
import { semanticIndexFacts } from './semantic/facts'

export async function semanticIndexFactsCached(root: string, files: readonly string[]): Promise<IndexPatchFacts> {
  const cacheInput = await semanticCacheKeyInput(root, files)
  if (!cacheInput) return semanticIndexFacts(root, files)

  const cacheFile = cacheFileForIdentity(root, SEMANTIC_FACTS_CACHE_EPOCH, cacheInput)
  const cached = await readCache(cacheFile)
  if (cached) return cached

  const facts = semanticIndexFacts(root, files)
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
    for (const name of indexCacheBoundaryFileNames) {
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
      version: SEMANTIC_FACTS_CACHE_EPOCH,
      typescriptVersion: ts.version,
      compilerOptionsVersion: SEMANTIC_COMPILER_OPTIONS_ID,
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

async function readCache(file: string): Promise<IndexPatchFacts | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    return isIndexPatchFacts(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function writeCache(file: string, facts: IndexPatchFacts): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(facts), 'utf8')
  } catch {
    // Semantic cache writes are best effort. Index indexing must never fail
    // because local cache storage is unavailable or read-only.
  }
}

function isIndexPatchFacts(value: unknown): value is IndexPatchFacts {
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
