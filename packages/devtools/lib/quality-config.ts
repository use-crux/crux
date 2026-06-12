/**
 * Quality runner configuration — loads the `quality:` block of
 * `crux.config.ts` (spec 01 §9), resolves zero-config defaults, and
 * scaffolds the persistence root's `.gitignore` (experiments and cache are
 * machine-local; baselines and cassettes are committed).
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AnyPrompt, Crux } from '@crux/core'
import type { QualityConfig } from '@crux/core/quality/api'
import { findConfigFile } from './eval-discovery'

// ─────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────

export interface LoadedQualityProject {
  /** The `quality:` config block — `{}` when the project doesn't declare one. */
  quality: QualityConfig
  /** Registered prompts (for rung-0 colocated test lowering). */
  prompts: readonly AnyPrompt[]
  /** Directory of the config file — the quality root for globs and ids. */
  configDir: string
  configPath: string
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
 * Import the project's `crux.config.ts` and read the quality block plus the
 * prompt registry. A missing `quality:` key is fine (zero-config); a missing
 * config file is a definition error (exit 2 at the CLI).
 */
export async function loadQualityProject(configPath?: string): Promise<LoadedQualityProject> {
  const absPath = configPath ? resolve(process.cwd(), configPath) : findConfigFile(process.cwd())
  if (!absPath) {
    throw new Error('No crux.config.ts found. Create one at your project root or use --config <path>.')
  }
  const configDir = dirname(absPath)
  const configModule = (await import(pathToFileURL(absPath).href)) as { default?: unknown }
  const exported = configModule.default ?? configModule
  if (!isCruxInstance(exported)) {
    throw new Error(`${absPath} does not export a Crux config — export default config({ ... }).`)
  }
  return {
    quality: exported.config.quality ?? {},
    prompts: exported.prompts,
    configDir,
    configPath: absPath,
  }
}

// ─────────────────────────────────────────────────────────────────
// Defaults resolution (spec 01 §9)
// ─────────────────────────────────────────────────────────────────

export interface QualityRunnerSettings {
  include: string[]
  exclude: string[]
  /** Absolute persistence root. */
  dir: string
  /** Workbench id — undefined lets the engine fall back to the package name. */
  qualityId: string | undefined
  redact: string[]
  defaults: { trials?: number; concurrency?: number; timeoutMs?: number }
  setup: QualityConfig['setup']
}

/** Apply the documented zero-config defaults over a (possibly empty) quality block. */
export function resolveQualityRunnerSettings(quality: QualityConfig, configDir: string): QualityRunnerSettings {
  const include = quality.include === undefined ? ['**/*.eval.ts'] : toArray(quality.include)
  const dir = quality.dir === undefined ? join(configDir, '.crux/quality') : absolutize(quality.dir, configDir)
  return {
    include,
    exclude: toArray(quality.exclude ?? []),
    dir,
    qualityId: quality.id,
    redact: [...(quality.redact ?? [])],
    defaults: { ...quality.defaults },
    setup: quality.setup,
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
