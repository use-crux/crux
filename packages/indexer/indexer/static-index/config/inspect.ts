import { resolve } from 'node:path'
import type { CruxLintConfig } from '@use-crux/core'
import type { IndexDiagnostic } from '@use-crux/core/project-index'
import { loadConfigPolicyProjectConfig } from '../../config'
import { staticIndexSyntaxSelectionFromConfig } from './index'

/** Options for inspecting only executable config needed by Static Index planning. */
export interface InspectProjectStaticIndexConfigOptions {
  /** Project root used for config lookup. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
}

/** One configured Indexer Extension reference from `crux.config.*`. */
export interface ProjectStaticIndexExtensionReference {
  /** Package name resolved from the config declaration. */
  readonly package: string
  /** Optional package export selected by the config declaration. */
  readonly export?: string
}

/**
 * Executable-config fragment needed before Go/Rust-owned Static Index planning.
 *
 * This artifact deliberately excludes source selection, cache status, relation
 * specs, rule descriptors, source graph rows, and schedulability decisions.
 * Those are either host-owned deterministic data or extension/runtime data
 * requested through a narrower boundary when third-party code must execute.
 */
export interface ProjectStaticIndexConfig {
  /** Absolute project root used by the compiler host. */
  readonly root: string
  /** Config file imported for policy, if one was discovered. */
  readonly configFile?: string
  /** Whether config opted into the experimental Static Index syntax path. */
  readonly staticSyntaxEnabled: boolean
  /** Optional Static Index syntax frontend selected by config. */
  readonly staticSyntaxFrontend?: 'oxc'
  /** Configured Indexer Extension references. */
  readonly extensions: readonly ProjectStaticIndexExtensionReference[]
  /** Authored lint policy used by first-party graph lints. */
  readonly lint?: CruxLintConfig
  /** Config-load diagnostics, kept small and JSON-safe for host reporting. */
  readonly diagnostics: readonly IndexDiagnostic[]
}

/**
 * Imports only `crux.config.*` policy needed to choose Static Index planning.
 *
 * The host may call this when a config file exists or an explicit `--config`
 * path was supplied. It must stay a config boundary: do not add source
 * discovery, cache planning, rule metadata, relation normalization, or static
 * host scheduling here.
 */
export async function inspectProjectStaticIndexConfig(
  options: InspectProjectStaticIndexConfigOptions,
): Promise<ProjectStaticIndexConfig> {
  const root = resolve(options.root)
  const result = await loadConfigPolicyProjectConfig(root, options.configPath)
  const selection = staticIndexSyntaxSelectionFromConfig(result.loaded.experimental)
  return {
    root,
    ...(result.loaded.configFile ? { configFile: result.loaded.configFile } : {}),
    staticSyntaxEnabled: selection.enabled,
    ...(selection.frontend ? { staticSyntaxFrontend: selection.frontend } : {}),
    extensions: (result.loaded.indexer?.extensions ?? []).map((extension) => ({
      package: extension.package,
      ...(extension.export ? { export: extension.export } : {}),
    })),
    ...(result.loaded.lint ? { lint: result.loaded.lint } : {}),
    diagnostics: result.diagnostics,
  }
}
