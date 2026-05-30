import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { collectImportBindings } from './ast/imports'
import { createSourceFile } from './ast/parse'
import { parseStaticDefinitions } from './static-file'
import type { StaticFileParser, StaticParseResult } from './types'

const CACHE_VERSION = 'static-parse-v11'

export async function parseStaticDefinitionsCached(
  root: string,
  file: string,
  parser: StaticFileParser,
): Promise<StaticParseResult> {
  const cacheInput = await cacheKeyInput(root, file)
  if (!cacheInput) return parseStaticDefinitions(root, file, parser)

  const cacheFile = join(root, '.crux', 'cache', 'catalog', CACHE_VERSION, `${sha256(JSON.stringify(cacheInput))}.json`)
  const cached = await readCache(cacheFile)
  if (cached) return cached

  const parsed = await parseStaticDefinitions(root, file, parser)
  await writeCache(cacheFile, parsed)
  return parsed
}

async function cacheKeyInput(
  root: string,
  file: string,
): Promise<
  | {
      version: string
      root: string
      file: string
      sourceHash: string
      dependencies: Array<{ file: string; sourceHash: string }>
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
    return {
      version: CACHE_VERSION,
      root,
      file: relative(root, file).replace(/\\/g, '/'),
      sourceHash: sha256(source),
      dependencies,
    }
  } catch {
    return undefined
  }
}

async function readCache(file: string): Promise<StaticParseResult | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
    return isStaticParseResult(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function writeCache(file: string, result: StaticParseResult): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(result), 'utf8')
  } catch {
    // Cache writes are best effort. Catalog indexing must never fail because
    // the local cache is unavailable or read-only.
  }
}

function isStaticParseResult(value: unknown): value is StaticParseResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StaticParseResult>
  return (
    Array.isArray(candidate.definitions) && Array.isArray(candidate.relations) && Array.isArray(candidate.dependencies)
  )
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
