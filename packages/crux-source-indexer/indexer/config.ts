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

export function loadStaticOnlyProjectConfig(
  root: string,
  configPath: string | undefined,
  diagnostics: CatalogDiagnostic[],
  sources: Map<string, CatalogSourceFile>,
): LoadedProjectConfig {
  const configMatches = configPath ? [resolve(root, configPath)] : findConfigFiles(root)
  const configFile = configMatches[0]
  if (configFile) addSource(sources, configFile, 'partial')
  diagnostics.push(staticOnlyDiagnostic(configFile))
  return { configFile, importFailed: true, staticOnly: true }
}

export async function loadProjectConfig(
  root: string,
  configPath: string | undefined,
  diagnostics: CatalogDiagnostic[],
  sources: Map<string, CatalogSourceFile>,
): Promise<LoadedProjectConfig> {
  const configMatches = configPath ? [resolve(root, configPath)] : findConfigFiles(root)
  const configFile = configMatches[0]
  if (!configFile) {
    diagnostics.push(configNotFoundDiagnostic())
    return {}
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
        return { configFile, crux: exported, eval: exported.config.eval, lint: exported.config.lint }
      }
      if (isEvalRunnerConfig(exported)) {
        return { configFile, legacyEval: exported }
      }
      diagnostics.push(configUnrecognizedDiagnostic(configFile))
      return { configFile }
    } catch (error) {
      addSource(sources, configFile, 'error')
      diagnostics.push(configImportFailedDiagnostic(configFile, errorMessage(error)))
      return { configFile, importFailed: true }
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
