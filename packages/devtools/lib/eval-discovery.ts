/**
 * Eval discovery — loads config, discovers eval files via globs or barrel imports.
 *
 * Supports two config formats:
 * - `crux.config.ts` (new): `config()` with glob-based eval discovery
 * - Legacy `EvalRunnerConfig`: barrel-import-based discovery
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { globSync } from 'tinyglobby'
import {
  isEvalDef,
  isFlowEvalDef,
  isRagEvalDef,
  type EvalDef,
  type FlowEvalDef,
  type RagEvalDef,
  type EvalRunnerConfig,
} from '@crux/core/testing'
import type { Crux, CruxEvalConfig, EvalSetupResult } from '@crux/core'
import type { PromptRegistry } from '@crux/core'
import type { QualityConfig } from '@crux/core/quality/types'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface DiscoveredEval {
  name: string
  def: EvalDef
}

export interface DiscoveredFlowEval {
  name: string
  def: FlowEvalDef
}

export interface DiscoveredRagEval {
  name: string
  def: RagEvalDef
}

/** Result of loading a config file. */
export interface LoadedConfig {
  /** The eval runner config (ready for the orchestrator). */
  evalConfig: EvalRunnerConfig
  /** Pre-built registry with full prompt hierarchy (only from crux.config.ts). */
  registry?: PromptRegistry
  /** Config directory for resolving relative globs. */
  configDir: string
  /** The raw Crux eval config (only from crux.config.ts). */
  cruxEval?: CruxEvalConfig
  /** The raw Crux quality config (only from crux.config.ts). */
  quality?: QualityConfig
}

// ─────────────────────────────────────────────────────────────────
// Config file discovery
// ─────────────────────────────────────────────────────────────────

const CONFIG_NAMES = ['crux.config.ts', 'crux.config.js', 'crux.config.mjs']

/**
 * Walk up from `startDir` looking for a Crux config file.
 * Returns the absolute path or `undefined` if not found.
 */
export function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

// ─────────────────────────────────────────────────────────────────
// Config loading
// ─────────────────────────────────────────────────────────────────

/** Check if a loaded module is a Crux instance (from config). */
function isCruxInstance(value: unknown): value is Crux {
  return (
    value != null &&
    typeof value === 'object' &&
    'config' in value &&
    'prompts' in value &&
    'get' in value &&
    typeof (value as { get?: unknown }).get === 'function'
  )
}

/**
 * Load a config file — supports both `crux.config.ts` (config) and
 * legacy `EvalRunnerConfig` formats.
 *
 * When `configPath` is omitted, auto-discovers `crux.config.ts` by walking up
 * from the current working directory.
 */
export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  const absPath = configPath ? resolve(process.cwd(), configPath) : findConfigFile(process.cwd())

  if (!absPath) {
    throw new Error('No crux.config.ts found. Create one at your project root or use --config <path>.')
  }

  const configDir = dirname(absPath)
  const configUrl = pathToFileURL(absPath).href
  const configModule = await import(configUrl)
  const exported = configModule.default ?? configModule

  // ── Crux config (config) ──
  if (isCruxInstance(exported)) {
    const crux = exported
    const evalSection = crux.config.eval

    if (!evalSection) {
      throw new Error('crux.config.ts has no `eval` section. Add an `eval` key with `include` and `setup()`.')
    }

    // Call lazy setup() to get generate + models
    const setupResult = await evalSection.setup()

    // Build an EvalRunnerConfig for the orchestrator (backward compat bridge)
    const evalConfig: EvalRunnerConfig = {
      generate: setupResult.generate,
      models: setupResult.models,
      // Glob-based discovery — wrapped as a function returning discovered exports
      evals: () => discoverModulesByGlob(evalSection.include, configDir),
      flowEvals: evalSection.flowInclude ? () => discoverModulesByGlob(evalSection.flowInclude!, configDir) : undefined,
      ragEvals: evalSection.ragInclude ? () => discoverModulesByGlob(evalSection.ragInclude!, configDir) : undefined,
      devtools: crux.config.devtools,
      concurrency: evalSection.concurrency,
      timeout: evalSection.timeout,
    }

    return { evalConfig, registry: crux, configDir, cruxEval: evalSection, quality: crux.config.quality }
  }

  // ── Legacy EvalRunnerConfig ──
  const config = exported as EvalRunnerConfig

  if (typeof config.generate !== 'function') {
    throw new Error('Config must export a `generate` function or use config()')
  }
  if (!config.models?.structured || !config.models?.text) {
    throw new Error('Config must export `models` with `structured` and `text` arrays')
  }
  if (typeof config.evals !== 'function') {
    throw new Error('Config must export an `evals` function')
  }

  return { evalConfig: config, configDir }
}

// ─────────────────────────────────────────────────────────────────
// Glob-based discovery
// ─────────────────────────────────────────────────────────────────

/**
 * Discover modules by glob pattern. Returns a merged record of all
 * named exports from matching files (for use by discoverEvals/discoverFlowEvals).
 */
async function discoverModulesByGlob(patterns: string | string[], cwd: string): Promise<Record<string, unknown>> {
  const patternArray = Array.isArray(patterns) ? patterns : [patterns]
  const files = globSync(patternArray, { cwd, absolute: true })

  const merged: Record<string, unknown> = {}
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href)
    for (const [key, value] of Object.entries(mod)) {
      if (key !== 'default') {
        merged[key] = value
      }
    }
  }

  return merged
}

// ─────────────────────────────────────────────────────────────────
// Barrel-based discovery (existing API, used by legacy configs)
// ─────────────────────────────────────────────────────────────────

/**
 * Discover EvalDef exports from a config's `evals()` loader function.
 * Optionally filter by name substring.
 */
export async function discoverEvals(
  loadEvals: () => Promise<Record<string, unknown>>,
  filter?: string,
): Promise<DiscoveredEval[]> {
  const mod = await loadEvals()
  const discovered: DiscoveredEval[] = []

  for (const [exportName, value] of Object.entries(mod)) {
    if (isEvalDef(value)) {
      const name = value.prompt.id ?? exportName.replace(/Eval$/, '')
      discovered.push({ name, def: value })
    }
  }

  // Sort by name for stable output
  discovered.sort((a, b) => a.name.localeCompare(b.name))

  if (filter) {
    return discovered.filter((e) => e.name.includes(filter))
  }

  return discovered
}

/**
 * Discover FlowEvalDef exports from a config's `flowEvals()` loader function.
 * Optionally filter by name substring.
 */
export async function discoverFlowEvals(
  loadFlowEvals: () => Promise<Record<string, unknown>>,
  filter?: string,
): Promise<DiscoveredFlowEval[]> {
  const mod = await loadFlowEvals()
  const discovered: DiscoveredFlowEval[] = []

  for (const [exportName, value] of Object.entries(mod)) {
    if (isFlowEvalDef(value)) {
      const name = value.name ?? exportName.replace(/Eval$/, '')
      discovered.push({ name, def: value })
    }
  }

  // Sort by name for stable output
  discovered.sort((a, b) => a.name.localeCompare(b.name))

  if (filter) {
    return discovered.filter((e) => e.name.includes(filter))
  }

  return discovered
}

/**
 * Discover RagEvalDef exports from a config's `ragEvals()` loader function.
 * Optionally filter by name substring.
 */
export async function discoverRagEvals(
  loadRagEvals: () => Promise<Record<string, unknown>>,
  filter?: string,
): Promise<DiscoveredRagEval[]> {
  const mod = await loadRagEvals()
  const discovered: DiscoveredRagEval[] = []

  for (const [exportName, value] of Object.entries(mod)) {
    if (isRagEvalDef(value)) {
      const name = value.id || exportName.replace(/Eval$/, '')
      discovered.push({ name, def: value })
    }
  }

  discovered.sort((a, b) => a.name.localeCompare(b.name))

  if (filter) {
    return discovered.filter((e) => e.name.includes(filter))
  }

  return discovered
}
