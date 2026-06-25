import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { collectImportBindings } from '../../ast/imports'
import { sha256, STATIC_PARSE_CACHE_EPOCH } from '../../cache-identity'
import { indexCacheBoundaryFileNames } from '../../incremental/boundaries'
import type { StaticSyntaxFileRecord } from '../../static-index/syntax/record'
import type { ParseMemo } from './source-io'
import type { StaticParseCacheEntryMetadata, StaticParseCacheSourceHash } from './types'

/**
 * Run-scoped cache-key context.
 *
 * Config boundary hashes are identical for every static file in one compiler
 * run. Memoizing them avoids repeated filesystem reads while preserving the
 * cache key shape.
 */
export interface StaticParseCacheKeyContext {
  /** Returns memoized hashes for project-level cache boundary files. */
  configFiles(): Promise<readonly StaticParseCacheSourceHash[]>
}

/** Creates a memoized cache-key context for one static extraction run. */
export function createStaticParseCacheKeyContext(root: string): StaticParseCacheKeyContext {
  let configFiles: Promise<readonly StaticParseCacheSourceHash[]> | undefined
  return {
    configFiles: () => {
      configFiles ??= readConfigFileHashes(root)
      return configFiles
    },
  }
}

/**
 * Computes the cache lookup input for one static file extraction.
 *
 * This TypeScript-source path is used before a syntax record exists. Native
 * batch misses should prefer `cacheKeyInputFromSyntaxRecord(...)` after parsing
 * so cache metadata can be derived from the backend-neutral record instead of
 * reparsing imports through TypeScript.
 */
export async function cacheKeyInput(input: {
  readonly root: string
  readonly file: string
  readonly parseMemo: ParseMemo
  readonly compilerInputs: readonly unknown[]
  readonly context?: StaticParseCacheKeyContext
}): Promise<StaticParseCacheEntryMetadata | undefined> {
  try {
    const sourceInfo = await input.parseMemo.readSourceInfo(input.file)
    const sourceFile = await input.parseMemo.readSourceFile(input.file)
    const dependencyFiles = [
      ...new Set(
        [...collectImportBindings(sourceFile, input.root, input.file).values()].map((binding) => binding.file),
      ),
    ].sort()
    return cacheKeyMetadata({
      root: input.root,
      file: input.file,
      sourceHash: sourceInfo.sourceHash,
      dependencyFiles,
      parseMemo: input.parseMemo,
      compilerInputs: input.compilerInputs,
      configFiles: await configFilesForInput(input.root, input.context),
    })
  } catch {
    return undefined
  }
}

/**
 * Computes static cache metadata from a parsed syntax record.
 *
 * The record already contains normalized imports and the source hash produced
 * by the selected syntax frontend, so native/provided batch extraction can
 * avoid a second TypeScript parse just to discover cache dependencies.
 */
export async function cacheKeyInputFromSyntaxRecord(input: {
  readonly root: string
  readonly record: StaticSyntaxFileRecord
  readonly parseMemo: ParseMemo
  readonly compilerInputs: readonly unknown[]
  readonly context?: StaticParseCacheKeyContext
}): Promise<StaticParseCacheEntryMetadata | undefined> {
  try {
    const sourceInfo = await input.parseMemo.readSourceInfo(input.record.file)
    if (sourceInfo.sourceHash !== input.record.sourceHash) return undefined
    const dependencyFiles = [
      ...new Set(input.record.imports.flatMap((importRecord) => importRecord.resolvedFile ?? [])),
    ].sort()
    return cacheKeyMetadata({
      root: input.root,
      file: input.record.file,
      sourceHash: input.record.sourceHash,
      dependencyFiles,
      parseMemo: input.parseMemo,
      compilerInputs: input.compilerInputs,
      configFiles: await configFilesForInput(input.root, input.context),
    })
  } catch {
    return undefined
  }
}

/** Reads cache-boundary config files and hashes the files that exist. */
export async function readConfigFileHashes(root: string): Promise<readonly StaticParseCacheSourceHash[]> {
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

async function cacheKeyMetadata(input: {
  readonly root: string
  readonly file: string
  readonly sourceHash: string
  readonly dependencyFiles: readonly string[]
  readonly parseMemo: ParseMemo
  readonly compilerInputs: readonly unknown[]
  readonly configFiles: readonly StaticParseCacheSourceHash[]
}): Promise<StaticParseCacheEntryMetadata> {
  const dependencies = []
  for (const dependencyFile of input.dependencyFiles) {
    dependencies.push({
      file: relative(input.root, dependencyFile).replace(/\\/g, '/'),
      sourceHash: (await input.parseMemo.readSourceInfo(dependencyFile)).sourceHash,
    })
  }
  return {
    version: STATIC_PARSE_CACHE_EPOCH,
    root: input.root,
    file: relative(input.root, input.file).replace(/\\/g, '/'),
    sourceHash: input.sourceHash,
    dependencies,
    configFiles: input.configFiles,
    compilerInputs: input.compilerInputs,
  }
}

function configFilesForInput(
  root: string,
  context: StaticParseCacheKeyContext | undefined,
): Promise<readonly StaticParseCacheSourceHash[]> {
  return context?.configFiles() ?? readConfigFileHashes(root)
}
