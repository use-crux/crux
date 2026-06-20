import { resolve } from 'node:path'
import type { ProjectModelResolutionMode } from '@crux/core/project-index'
import type { IndexDiagnostic, IndexSourceFile } from '@crux/core/project-index'
import type { Crux, CruxExperimentalConfig, CruxIndexerConfig, CruxLintConfig, QualityConfig } from '@crux/core'
import {
  configImportFailedDiagnostic,
  configNotFoundDiagnostic,
  configUnrecognizedDiagnostic,
  multipleConfigsDiagnostic,
  sourceOnlyDiagnostic,
} from './diagnostics'
import { findConfigFiles } from './files'
import { importUserModule, withCruxIndexMode } from './imports'
import { resolutionModeImportsSource } from './resolution-mode'
import { addSource } from './sources'

export interface LoadedProjectConfig {
  readonly configFile?: string
  readonly crux?: Crux
  readonly quality?: QualityConfig
  readonly indexer?: CruxIndexerConfig
  readonly experimental?: CruxExperimentalConfig
  readonly lint?: CruxLintConfig
  readonly importFailed?: boolean
  readonly importSkipped?: boolean
  readonly resolutionMode: ProjectModelResolutionMode
  readonly sourceImports: boolean
}

export interface LoadedProjectConfigResult {
  readonly loaded: LoadedProjectConfig
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly sources: readonly IndexSourceFile[]
}

/** Load source-only config metadata without importing any user modules. */
export function loadSourceOnlyProjectConfig(root: string, configPath: string | undefined): LoadedProjectConfigResult {
  const diagnostics: IndexDiagnostic[] = []
  const sources = new Map<string, IndexSourceFile>()
  const configMatches = configPath ? [resolve(root, configPath)] : findConfigFiles(root)
  const configFile = configMatches[0]
  if (configFile) addSource(sources, configFile, 'partial')
  diagnostics.push(sourceOnlyDiagnostic(configFile))
  return {
    loaded: {
      configFile,
      importSkipped: true,
      resolutionMode: 'source-only',
      sourceImports: false,
    },
    diagnostics,
    sources: [...sources.values()],
  }
}

/** Load explicit config policy without permitting discovered source imports. */
export function loadConfigPolicyProjectConfig(
  root: string,
  configPath: string | undefined,
): Promise<LoadedProjectConfigResult> {
  return importProjectConfig(root, configPath, 'config-policy')
}

/** Load config for bounded semantic enrichment without permitting source imports. */
export function loadSemanticProjectConfig(
  root: string,
  configPath: string | undefined,
): Promise<LoadedProjectConfigResult> {
  return importProjectConfig(root, configPath, 'semantic')
}

/** Load config for explicit runtime-rich indexing. */
export function loadRuntimeRichProjectConfig(
  root: string,
  configPath: string | undefined,
): Promise<LoadedProjectConfigResult> {
  return importProjectConfig(root, configPath, 'runtime-rich')
}

/**
 * Load config according to a Project Model resolution mode.
 *
 * This is the compiler-facing boundary. Callers choose the evidence mode once;
 * the returned `LoadedProjectConfig` carries both the mode and whether source
 * imports are permitted for downstream discovery.
 */
export async function loadProjectConfig(
  root: string,
  configPath: string | undefined,
  resolutionMode: ProjectModelResolutionMode = 'runtime-rich',
): Promise<LoadedProjectConfigResult> {
  switch (resolutionMode) {
    case 'source-only':
      return loadSourceOnlyProjectConfig(root, configPath)
    case 'config-policy':
      return loadConfigPolicyProjectConfig(root, configPath)
    case 'semantic':
      return loadSemanticProjectConfig(root, configPath)
    case 'runtime-rich':
      return loadRuntimeRichProjectConfig(root, configPath)
  }
}

async function importProjectConfig(
  root: string,
  configPath: string | undefined,
  resolutionMode: Exclude<ProjectModelResolutionMode, 'source-only'>,
): Promise<LoadedProjectConfigResult> {
  const diagnostics: IndexDiagnostic[] = []
  const sources = new Map<string, IndexSourceFile>()
  const configMatches = configPath ? [resolve(root, configPath)] : findConfigFiles(root)
  const configFile = configMatches[0]
  const sourceImports = resolutionModeImportsSource(resolutionMode)
  if (!configFile) {
    diagnostics.push(configNotFoundDiagnostic())
    return { loaded: { resolutionMode, sourceImports }, diagnostics, sources: [...sources.values()] }
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
          loaded: {
            configFile,
            crux: exported,
            quality: exported.config.quality,
            indexer: exported.config.indexer,
            experimental: exported.config.experimental,
            lint: exported.config.lint,
            resolutionMode,
            sourceImports,
          },
          diagnostics,
          sources: [...sources.values()],
        }
      }
      diagnostics.push(configUnrecognizedDiagnostic(configFile))
      return { loaded: { configFile, resolutionMode, sourceImports }, diagnostics, sources: [...sources.values()] }
    } catch (error) {
      addSource(sources, configFile, 'error')
      diagnostics.push(configImportFailedDiagnostic(configFile, errorMessage(error)))
      return {
        loaded: { configFile, importFailed: true, resolutionMode, sourceImports },
        diagnostics,
        sources: [...sources.values()],
      }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
