import { resolve } from 'node:path'
import type { CruxLintConfig } from '@crux/core'
import type { IndexDiagnostic } from '@crux/core/project-index'
import { loadConfigPolicyProjectConfig } from './config'
import { nativeStaticAstSelectionFromConfig } from './native-static-config'

/** Options for inspecting only executable config needed by native static planning. */
export interface InspectProjectNativeStaticConfigOptions {
  /** Project root used for config lookup. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
}

/** One configured Indexer Extension reference from `crux.config.*`. */
export interface ProjectNativeStaticExtensionReference {
  /** Package name resolved from the config declaration. */
  readonly package: string
  /** Optional package export selected by the config declaration. */
  readonly export?: string
}

/**
 * Executable-config fragment needed before Go/Rust-owned native static planning.
 *
 * This artifact deliberately excludes source selection, cache status, relation
 * specs, rule descriptors, source graph rows, and schedulability decisions.
 * Those are either host-owned deterministic data or extension/runtime data
 * requested through a narrower boundary when third-party code must execute.
 */
export interface ProjectNativeStaticConfig {
  /** Absolute project root used by the compiler host. */
  readonly root: string
  /** Config file imported for policy, if one was discovered. */
  readonly configFile?: string
  /** Whether config opted into the experimental native static AST path. */
  readonly nativeAstEnabled: boolean
  /** Optional native static frontend selected by config. */
  readonly nativeAstFrontend?: 'oxc'
  /** Configured Indexer Extension references. */
  readonly extensions: readonly ProjectNativeStaticExtensionReference[]
  /** Authored lint policy used by native first-party graph lints. */
  readonly lint?: CruxLintConfig
  /** Config-load diagnostics, kept small and JSON-safe for host reporting. */
  readonly diagnostics: readonly IndexDiagnostic[]
}

/**
 * Imports only `crux.config.*` policy needed to choose native static planning.
 *
 * The host may call this when a config file exists or an explicit `--config`
 * path was supplied. It must stay a config boundary: do not add source
 * discovery, cache planning, rule metadata, relation normalization, or static
 * host scheduling here.
 */
export async function inspectProjectNativeStaticConfig(
  options: InspectProjectNativeStaticConfigOptions,
): Promise<ProjectNativeStaticConfig> {
  const root = resolve(options.root)
  const result = await loadConfigPolicyProjectConfig(root, options.configPath)
  const selection = nativeStaticAstSelectionFromConfig(result.loaded.experimental)
  return {
    root,
    ...(result.loaded.configFile ? { configFile: result.loaded.configFile } : {}),
    nativeAstEnabled: selection.enabled,
    ...(selection.frontend ? { nativeAstFrontend: selection.frontend } : {}),
    extensions: (result.loaded.indexer?.extensions ?? []).map((extension) => ({
      package: extension.package,
      ...(extension.export ? { export: extension.export } : {}),
    })),
    ...(result.loaded.lint ? { lint: result.loaded.lint } : {}),
    diagnostics: result.diagnostics,
  }
}
