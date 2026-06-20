import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { ProjectIndexShard } from '@crux/core/project-index'
import { globSync } from 'tinyglobby'
import type { ProjectShardFileBatch, ProjectShardGraph } from './types'

const PACKAGE_MANIFEST = 'package.json'
const PNPM_WORKSPACE = 'pnpm-workspace.yaml'
const TSCONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'] as const

/**
 * Discovers package/workspace shards for a project root.
 *
 * The discovery contract is deliberately filesystem-based: package manifests,
 * workspace manifests, and TypeScript project references are durable evidence
 * that can be cached and replayed without importing user modules.
 */
export function discoverProjectShards(root: string): ProjectShardGraph {
  const projectRoot = resolve(root)
  const discovered = new Map<string, ShardDraft>()

  addPackageShard(discovered, projectRoot, projectRoot, manifestPath(projectRoot))
  for (const packageRoot of workspacePackageRoots(projectRoot)) {
    addPackageShard(discovered, projectRoot, packageRoot, manifestPath(packageRoot))
  }

  const shardsWithoutReferences = [...discovered.values()].map((draft) => shardFromDraft(draft, []))
  const shardIdByRoot = new Map(shardsWithoutReferences.map((shard) => [shard.root, shard.id]))
  return {
    shards: shardsWithoutReferences
      .map((shard) => ({
        ...shard,
        references: [...referencedShardIds(shard.configFile, shardIdByRoot)],
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/**
 * Returns the owning shard for an absolute source file.
 *
 * Longest-root matching makes nested package roots win over the workspace root.
 */
export function shardIdForSourceFile(
  file: string,
  shards: readonly ProjectIndexShard[],
): ProjectIndexShard['id'] | undefined {
  const normalizedFile = resolve(file)
  return [...shards]
    .sort((a, b) => b.root.length - a.root.length)
    .find((shard) => normalizedFile === shard.root || normalizedFile.startsWith(`${shard.root}/`))?.id
}

/**
 * Groups source files into deterministic shard-owned execution batches.
 *
 * Files without shard ownership are omitted so callers can decide whether to
 * degrade or run a separate fallback. Compiler-owned static indexing passes
 * should use complete shard evidence before relying on these batches.
 */
export function staticFileBatchesForShards(
  files: readonly string[],
  shards: readonly ProjectIndexShard[],
): readonly ProjectShardFileBatch[] {
  const shardById = new Map(shards.map((shard) => [shard.id, shard]))
  const filesByShardId = new Map<string, string[]>()

  for (const file of files) {
    const shardId = shardIdForSourceFile(file, shards)
    if (!shardId) continue
    filesByShardId.set(shardId, [...(filesByShardId.get(shardId) ?? []), file])
  }

  const batches: ProjectShardFileBatch[] = []
  for (const [shardId, shardFiles] of filesByShardId) {
    const shard = shardById.get(shardId)
    if (!shard) continue
    const ownedFiles = [...new Set(shardFiles)].sort()
    if (ownedFiles.length > 0) batches.push({ shard, files: ownedFiles })
  }
  return batches.sort((a, b) => a.shard.id.localeCompare(b.shard.id))
}

interface ShardDraft {
  readonly id: string
  readonly root: string
  readonly packageFile?: string
  readonly discoveredBy?: string
}

function addPackageShard(
  discovered: Map<string, ShardDraft>,
  projectRoot: string,
  packageRoot: string,
  packageFile: string | undefined,
): void {
  if (discovered.has(packageRoot)) return
  discovered.set(packageRoot, {
    id: shardId(projectRoot, packageRoot),
    root: packageRoot,
    ...(packageFile ? { packageFile, discoveredBy: packageFile } : {}),
  })
}

function shardFromDraft(draft: ShardDraft, references: readonly string[]): ProjectIndexShard {
  const packageJson = draft.packageFile ? readJsonObject(draft.packageFile) : undefined
  const configFile = selectedConfigFile(draft.root)
  return {
    id: draft.id,
    root: draft.root,
    ...(typeof packageJson?.name === 'string' ? { name: packageJson.name } : {}),
    ...(draft.packageFile ? { packageFile: draft.packageFile } : {}),
    ...(configFile ? { configFile } : {}),
    ...(draft.discoveredBy ? { discoveredBy: draft.discoveredBy } : {}),
    ...(references.length > 0 ? { references: [...references] } : {}),
  }
}

function workspacePackageRoots(root: string): readonly string[] {
  return [...new Set([...pnpmWorkspacePackageRoots(root), ...packageJsonWorkspacePackageRoots(root)])].sort()
}

function pnpmWorkspacePackageRoots(root: string): readonly string[] {
  const workspaceFile = join(root, PNPM_WORKSPACE)
  if (!existsSync(workspaceFile)) return []
  return workspacePackageRootsFromPatterns(root, pnpmWorkspacePackagePatterns(readFileSync(workspaceFile, 'utf8')))
}

function packageJsonWorkspacePackageRoots(root: string): readonly string[] {
  const value = readJsonObject(manifestPath(root))
  const workspaces = value?.workspaces
  const patterns = Array.isArray(workspaces)
    ? workspaces.filter(isString)
    : isRecord(workspaces) && Array.isArray(workspaces.packages)
      ? workspaces.packages.filter(isString)
      : []
  return workspacePackageRootsFromPatterns(root, patterns)
}

function workspacePackageRootsFromPatterns(root: string, patterns: readonly string[]): readonly string[] {
  const packageJsonPatterns = patterns
    .filter((pattern) => pattern.length > 0 && !pattern.startsWith('!'))
    .map((pattern) => `${pattern.replace(/\/+$/, '')}/${PACKAGE_MANIFEST}`)
  if (packageJsonPatterns.length === 0) return []
  return globSync(packageJsonPatterns, {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
  }).map(dirname)
}

function pnpmWorkspacePackagePatterns(source: string): readonly string[] {
  const patterns: string[] = []
  let inPackages = false
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*packages\s*:/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const match = line.match(/^\s*-\s*['"]?([^'"\s][^'"]*?)['"]?\s*$/)
    if (match?.[1]) patterns.push(match[1].trim())
    else if (/^\S/.test(line)) break
  }
  return patterns
}

function referencedShardIds(
  configFile: string | undefined,
  shardIdByRoot: ReadonlyMap<string, string>,
): readonly string[] {
  if (!configFile) return []
  const config = readJsonObject(configFile)
  const references = Array.isArray(config?.references) ? config.references : []
  return [
    ...new Set(
      references
        .map((reference) => (isRecord(reference) && typeof reference.path === 'string' ? reference.path : undefined))
        .filter(isString)
        .map((referencePath) => resolve(dirname(configFile), referencePath))
        .map((referenceRoot) => shardIdByRoot.get(referenceRoot))
        .filter(isString),
    ),
  ].sort()
}

function selectedConfigFile(root: string): string | undefined {
  return TSCONFIG_NAMES.map((name) => join(root, name)).find((file) => existsSync(file))
}

function manifestPath(root: string): string {
  return join(root, PACKAGE_MANIFEST)
}

function shardId(root: string, packageRoot: string): string {
  const id = relative(root, packageRoot).split('\\').join('/')
  return id.length > 0 ? id : '.'
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
