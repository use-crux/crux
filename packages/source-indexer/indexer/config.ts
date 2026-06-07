import { resolve } from 'node:path'
import type { CatalogDiagnostic, CatalogSourceFile } from '@crux/core/catalog'
import type { Crux, CruxEvalConfig, CruxLintConfig } from '@crux/core'
import type { EvalRunnerConfig } from '@crux/core/testing'
import {
  configImportFailedDiagnostic,
  configNotFoundDiagnostic,
  configUnrecognizedDiagnostic,
  multipleConfigsDiagnostic,
  staticOnlyDiagnostic,
} from './diagnostics'
import { findConfigFiles } from './files'
import { importUserModule, withCruxIndexMode } from './imports'
import { addSource } from './sources'

export interface LoadedProjectConfig {
  configFile?: string
  crux?: Crux
  eval?: CruxEvalConfig
  lint?: CruxLintConfig
  legacyEval?: EvalRunnerConfig
  importFailed?: boolean
  staticOnly?: boolean
}

export interface LoadedProjectConfigResult {
  readonly loaded: LoadedProjectConfig
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly sources: readonly CatalogSourceFile[]
}

export function loadStaticOnlyProjectConfig(root: string, configPath: string | undefined): LoadedProjectConfigResult {
  const diagnostics: CatalogDiagnostic[] = []
  const sources = new Map<string, CatalogSourceFile>()
  const configMatches = configPath ? [resolve(root, configPath)] : findConfigFiles(root)
  const configFile = configMatches[0]
  if (configFile) addSource(sources, configFile, 'partial')
  diagnostics.push(staticOnlyDiagnostic(configFile))
  return { loaded: { configFile, importFailed: true, staticOnly: true }, diagnostics, sources: [...sources.values()] }
}

export async function loadProjectConfig(
  root: string,
  configPath: string | undefined,
): Promise<LoadedProjectConfigResult> {
  const diagnostics: CatalogDiagnostic[] = []
  const sources = new Map<string, CatalogSourceFile>()
  const configMatches = configPath ? [resolve(root, configPath)] : findConfigFiles(root)
  const configFile = configMatches[0]
  if (!configFile) {
    diagnostics.push(configNotFoundDiagnostic())
    return { loaded: {}, diagnostics, sources: [...sources.values()] }
  }
  if (configMatches.length > 1) {
    diagnostics.push(multipleConfigsDiagnostic(root, configFile, configMatches.length))
  }

  addSource(sources, configFile, 'indexed')

  return withCruxIndexMode(async () => {
    try {
      const mod = await importUserModule(configFile, 8_000)
      const exported = (mod as { default?: unknown }).default ?? mod
      if (isCruxInstance(exported)) {
        return {
          loaded: { configFile, crux: exported, eval: exported.config.eval, lint: exported.config.lint },
          diagnostics,
          sources: [...sources.values()],
        }
      }
      if (isEvalRunnerConfig(exported)) {
        return { loaded: { configFile, legacyEval: exported }, diagnostics, sources: [...sources.values()] }
      }
      diagnostics.push(configUnrecognizedDiagnostic(configFile))
      return { loaded: { configFile }, diagnostics, sources: [...sources.values()] }
    } catch (error) {
      addSource(sources, configFile, 'error')
      diagnostics.push(configImportFailedDiagnostic(configFile, errorMessage(error)))
      return { loaded: { configFile, importFailed: true }, diagnostics, sources: [...sources.values()] }
    }
  })
}

function isCruxInstance(value: unknown): value is Crux {
  return (
    value != null &&
    typeof value === 'object' &&
    'config' in value &&
    'prompts' in value &&
    'contexts' in value &&
    'get' in value &&
    typeof (value as { get?: unknown }).get === 'function'
  )
}

function isEvalRunnerConfig(value: unknown): value is EvalRunnerConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Record<string, unknown>
  return typeof config.evals === 'function' && typeof config.generate === 'function'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
