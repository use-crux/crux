import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { collectImportBindings } from '../../ast/imports'
import { cacheFileForIdentity, sha256, STATIC_PARSE_CACHE_EPOCH } from '../../cache-identity'
import { indexCacheBoundaryFileNames } from '../../incremental/boundaries'
import type { StaticParseResult } from '../../types'
import type { StaticFileExtraction, StaticParseCacheStore } from './engine'
import type { ParseMemo } from './source-io'

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

export function persistentStaticParseCache(root: string): StaticParseCacheStore {
  return Object.freeze({
    get: async (key: string) => readCache(cacheFileForIdentity(root, STATIC_PARSE_CACHE_EPOCH, key)),
    set: async (key: string, value: StaticFileExtraction) =>
      writeCache(cacheFileForIdentity(root, STATIC_PARSE_CACHE_EPOCH, key), value),
  })
}

export function noStaticParseCache(): StaticParseCacheStore {
  return Object.freeze({
    get: async () => undefined,
    set: async () => undefined,
  })
}

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

async function readCache(file: string): Promise<StaticFileExtraction | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    return isStaticFileExtraction(parsed) ? { ...parsed, fromCache: true } : undefined
  } catch {
    return undefined
  }
}

async function writeCache(file: string, result: StaticFileExtraction): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    const { fromCache: _fromCache, ...cacheable } = result
    await writeFile(file, JSON.stringify(cacheable), 'utf8')
  } catch {
    // Cache writes are best effort. Indexing must never fail because the local cache is unavailable.
  }
}

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
