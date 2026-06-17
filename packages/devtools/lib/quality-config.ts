/**
 * Quality runner configuration — loads the `quality:` block of
 * `crux.config.ts` when present, resolves no-config source discovery
 * defaults, and scaffolds the persistence root's `.gitignore` (experiments
 * and cache are machine-local; baselines and cassettes are committed).
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AnyPrompt, Crux } from '@crux/core'
import type { ProjectModelDiagnostic } from '@crux/core/project-index'
import type { QualityConfig, ReplayMode } from '@crux/core/quality'
import { discoverQualityPromptTests } from './quality-prompt-discovery'

const CONFIG_NAMES = ['crux.config.ts', 'crux.config.js', 'crux.config.mjs']
const DEFAULT_QUALITY_INCLUDE = ['evals/**/*.eval.ts', '**/*.eval.ts'] as const

/** Walk up from `startDir` to find the project's Crux config file. */
export function findQualityConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir)
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Walk up from `startDir` to find the nearest package root. */
export function findQualityPackageRoot(startDir: string): string | undefined {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Read the nearest package name, when a package root can be proven from `startDir`. */
export function findQualityPackageName(startDir: string): string | undefined {
  const packageRoot = findQualityPackageRoot(startDir)
  if (packageRoot === undefined) return undefined
  const packageJson: unknown = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  return isPackageJsonWithName(packageJson) ? packageJson.name : undefined
}

function isPackageJsonWithName(value: unknown): value is { readonly name: string } {
  if (value === null || typeof value !== 'object') return false
  const name = (value as { readonly name?: unknown }).name
  return typeof name === 'string' && name.length > 0
}

export interface QualityProjectRoot {
  /** Root used for quality globs, persistence defaults, and project-local imports. */
  rootDir: string
  /** Config file selected for import, when one exists or was passed explicitly. */
  configPath?: string
}

/**
 * Resolve the local Quality project root.
 *
 * Discovery follows the product rule from the config-discovery workplan:
 * explicit config paths select their directory, otherwise the nearest Crux
 * config wins, then the nearest `package.json`, and finally the current
 * working directory. Missing config is therefore a normal source-only state.
 */
export function resolveQualityProjectRoot(configPath?: string): QualityProjectRoot {
  const cwd = process.cwd()
  if (configPath !== undefined) {
    const resolvedConfigPath = resolve(cwd, configPath)
    return { rootDir: dirname(resolvedConfigPath), configPath: resolvedConfigPath }
  }

  const discoveredConfigPath = findQualityConfigFile(cwd)
  if (discoveredConfigPath !== undefined) {
    return { rootDir: dirname(discoveredConfigPath), configPath: discoveredConfigPath }
  }

  return { rootDir: findQualityPackageRoot(cwd) ?? resolve(cwd) }
}

// ─────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────

export interface LoadedQualityProject {
  /** The `quality:` config block — `{}` when the project doesn't declare one. */
  quality: QualityConfig
  /** Source-discovered prompts used for rung-0 colocated test lowering. */
  prompts: readonly AnyPrompt[]
  /** Prompt-test diagnostics discovered through the Project Model. */
  promptDiagnostics: readonly ProjectModelDiagnostic[]
  /** Project root for quality globs, ids, project-local imports, and persistence defaults. */
  configDir: string
  /** Imported config file, absent when Quality is running from source conventions only. */
  configPath?: string
}

function isCruxInstance(value: unknown): value is Crux {
  return (
    value != null &&
    typeof value === 'object' &&
    'config' in value &&
    'prompts' in value &&
    typeof (value as { get?: unknown }).get === 'function'
  )
}

/**
 * Load the Quality project model used by the runner.
 *
 * When a Crux config is present, the config module supplies the `quality:`
 * block. Prompt tests are collected from source-discovered prompt exports
 * rather than from config-level registration. When no config is present,
 * Quality uses source-discovery conventions: empty quality policy and prompt
 * files discovered from the project root.
 */
export async function loadQualityProject(configPath?: string): Promise<LoadedQualityProject> {
  const projectRoot = resolveQualityProjectRoot(configPath)
  if (projectRoot.configPath === undefined) {
    const discovered = await discoverQualityPromptTests({ rootDir: projectRoot.rootDir })
    return {
      quality: {},
      prompts: discovered.prompts,
      promptDiagnostics: discovered.diagnostics,
      configDir: projectRoot.rootDir,
    }
  }
  if (!existsSync(projectRoot.configPath)) {
    throw new Error(`Crux config file not found at ${projectRoot.configPath}.`)
  }
  const configModule = (await import(pathToFileURL(projectRoot.configPath).href)) as { default?: unknown }
  const exported = configModule.default ?? configModule
  if (!isCruxInstance(exported)) {
    throw new Error(`${projectRoot.configPath} does not export a Crux config — export default config({ ... }).`)
  }
  const discovered = await discoverQualityPromptTests({
    rootDir: projectRoot.rootDir,
    configPath: projectRoot.configPath,
    configModule: configModule as Record<string, unknown>,
  })
  return {
    quality: exported.config.quality ?? {},
    prompts: discovered.prompts,
    promptDiagnostics: discovered.diagnostics,
    configDir: projectRoot.rootDir,
    configPath: projectRoot.configPath,
  }
}

// ─────────────────────────────────────────────────────────────────
// Defaults resolution
// ─────────────────────────────────────────────────────────────────

export interface QualityRunnerSettings {
  include: string[]
  exclude: string[]
  /** Absolute persistence root. */
  dir: string
  /** Workbench id from explicit config or the nearest package name. */
  qualityId: string | undefined
  redact: string[]
  defaults: { trials?: number; concurrency?: number; timeoutMs?: number; replay?: ReplayMode }
}

/**
 * Resolve the Quality runner settings used by the CLI worker.
 *
 * This is the public settings seam for local tooling: explicit `quality:`
 * config wins, then source-discovery conventions fill in the predictable
 * local defaults.
 */
export function resolveQualityRunnerSettings(quality: QualityConfig, configDir: string): QualityRunnerSettings {
  const include = quality.include === undefined ? [...DEFAULT_QUALITY_INCLUDE] : toArray(quality.include)
  const dir = quality.dir === undefined ? join(configDir, '.crux/quality') : absolutize(quality.dir, configDir)
  const packageName = findQualityPackageName(configDir)
  return {
    include,
    exclude: toArray(quality.exclude ?? []),
    dir,
    qualityId: quality.id ?? packageName,
    redact: [...(quality.redact ?? [])],
    defaults: { ...quality.defaults },
  }
}

function toArray(value: string | readonly string[]): string[] {
  return typeof value === 'string' ? [value] : [...value]
}

function absolutize(path: string, base: string): string {
  return isAbsolute(path) ? path : join(base, path)
}

// ─────────────────────────────────────────────────────────────────
// Persistence-root scaffolding
// ─────────────────────────────────────────────────────────────────

const GITIGNORE_CONTENT = `# Crux Quality — machine-local artifacts (baselines/ and cassettes/ are committed)
experiments/
cache/
`

/**
 * Write `<dir>/.gitignore` on first persistence so experiment records and
 * the watch cache never land in the repo. Existing files are never touched.
 */
export async function ensureQualityGitignore(dir: string): Promise<void> {
  const path = join(dir, '.gitignore')
  if (existsSync(path)) return
  await mkdir(dir, { recursive: true })
  await writeFile(path, GITIGNORE_CONTENT, 'utf8')
}
