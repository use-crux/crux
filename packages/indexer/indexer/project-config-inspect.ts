/**
 * Effective-configuration read model for `crux config inspect`.
 *
 * Unlike {@link resolveProjectModel}, which describes what source discovery can
 * see without importing user modules, this resolver imports the project's
 * `crux.config.ts` in inert `CRUX_INDEX=1` mode (no runtime side effects) and
 * renders the effective {@link CruxConfig}: every domain `config()` accepts, with
 * each value tagged by where it came from — an explicit config value, a built-in
 * default, package metadata, or the presence of a non-serializable binding
 * (store, tokenizer, middleware, transport).
 *
 * It is a representation of configuration, not of authored primitives. A compact
 * discovery summary (definition/relation counts) is included for context; the
 * full authored index lives behind `crux index`.
 *
 * @module
 */

import type { CruxConfig } from '@crux/core'
import type { IndexDiagnostic } from '@crux/core/project-index'
import { loadProjectConfig } from './config'
import { resolveProjectModel } from './project-model'

const DEFAULT_QUALITY_INCLUDE = ['evals/**/*.eval.ts', '**/*.eval.ts'] as const
const DEFAULT_QUALITY_DIR = '.crux/quality'
const DEFAULT_QUALITY_TRIALS = 1
const DEFAULT_QUALITY_CONCURRENCY = 5
const DEFAULT_QUALITY_TIMEOUT_MS = 60_000
const DEFAULT_QUALITY_REPLAY = 'live'
const DEFAULT_INDEXER_TRUST = 'first-party-only'
const DEFAULT_LINT_PROFILE = 'recommended'

/** How a config value was resolved, shown as an origin tag in the CLI. */
export type ProjectConfigOrigin = 'default' | 'config' | 'package.json' | 'set' | 'none'

/** Where the resolver located the config file. */
export type ProjectConfigFileOrigin = 'discovered' | '--config' | 'none'

/** Resolution status of the config file once import was attempted. */
export type ProjectConfigFileStatus = 'loaded' | 'missing' | 'import-failed' | 'unrecognized'

/** One resolved scalar config value plus its origin. */
export interface ProjectConfigSetting {
  readonly value: string
  readonly origin: ProjectConfigOrigin
}

/** One resolved list config value plus its origin. */
export interface ProjectConfigList {
  readonly values: readonly string[]
  readonly origin: ProjectConfigOrigin
}

/** The effective configuration as `crux config inspect` renders it. */
export interface ProjectConfigInspect {
  readonly root: string
  readonly packageName?: string
  readonly configFile: {
    readonly path?: string
    readonly status: ProjectConfigFileStatus
    readonly origin: ProjectConfigFileOrigin
    readonly error?: string
  }
  readonly quality: {
    readonly id: ProjectConfigSetting
    readonly dir: ProjectConfigSetting
    readonly include: ProjectConfigList
    readonly exclude: ProjectConfigList
    readonly redact: ProjectConfigList
    readonly trials: ProjectConfigSetting
    readonly concurrency: ProjectConfigSetting
    readonly timeoutMs: ProjectConfigSetting
    readonly replay: ProjectConfigSetting
  }
  readonly generation: {
    readonly autoEscape: ProjectConfigSetting
    readonly securityWarnings: ProjectConfigSetting
    readonly tokenizer: ProjectConfigSetting
    readonly middleware: ProjectConfigSetting
  }
  readonly indexer: {
    readonly trust: ProjectConfigSetting
    readonly extensions: ProjectConfigList
  }
  readonly observability: {
    readonly enabled: ProjectConfigSetting
    readonly serverUrl: ProjectConfigSetting
    readonly transport: ProjectConfigSetting
  }
  readonly devtools: {
    readonly serverUrl: ProjectConfigSetting
    readonly bridge: ProjectConfigSetting
  }
  readonly persistence: {
    readonly store: ProjectConfigSetting
  }
  readonly lint: {
    readonly profile: ProjectConfigSetting
    readonly rules: ProjectConfigSetting
  }
  readonly plugins: ProjectConfigList
  readonly discovered: {
    readonly definitions: number
    readonly relations: number
    readonly evaluations: number
    readonly definitionKinds: Readonly<Record<string, number>>
  }
  readonly diagnostics: readonly { readonly severity: string; readonly code: string; readonly message: string }[]
}

/** Options for {@link inspectProjectConfig}. */
export interface InspectProjectConfigOptions {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
}

const explicit = (value: unknown): ProjectConfigSetting => ({ value: String(value), origin: 'config' })
const fromDefault = (value: unknown): ProjectConfigSetting => ({ value: String(value), origin: 'default' })
const presence = (present: boolean): ProjectConfigSetting =>
  present ? { value: 'set', origin: 'set' } : { value: 'none', origin: 'none' }

function toStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  return typeof value === 'string' ? [value] : [...value]
}

/**
 * Resolve the effective Crux configuration for `crux config inspect`.
 *
 * Imports `crux.config.ts` in inert `CRUX_INDEX=1` mode to read explicit values,
 * merges built-in defaults for everything unset, and pairs each value with its
 * origin. Import failures degrade to an all-defaults view with an `import-failed`
 * config status and the error surfaced in diagnostics — inspection never throws
 * on a broken config.
 */
export async function inspectProjectConfig(options: InspectProjectConfigOptions): Promise<ProjectConfigInspect> {
  const { loaded, diagnostics: configDiagnostics } = await loadProjectConfig(options.root, options.configPath)
  const model = await resolveProjectModel({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    staticOnly: true,
  })

  const cfg: CruxConfig | undefined = loaded.crux?.config
  const packageName = model.packageName?.value
  const quality = cfg?.quality
  const generation = cfg?.generation
  const indexer = cfg?.indexer
  const observability = cfg?.observability
  const devtools = cfg?.devtools
  const lint = cfg?.lint

  const definitionKinds: Record<string, number> = {}
  for (const definition of model.definitions) {
    definitionKinds[definition.kind] = (definitionKinds[definition.kind] ?? 0) + 1
  }

  return {
    root: model.root.value,
    ...(packageName ? { packageName } : {}),
    configFile: configFileSummary(loaded, options.configPath, configDiagnostics),
    quality: {
      id:
        quality?.id != null
          ? explicit(quality.id)
          : packageName
            ? { value: packageName, origin: 'package.json' }
            : { value: 'none', origin: 'none' },
      dir: quality?.dir != null ? explicit(quality.dir) : fromDefault(DEFAULT_QUALITY_DIR),
      include:
        quality?.include != null
          ? { values: toStringArray(quality.include), origin: 'config' }
          : { values: [...DEFAULT_QUALITY_INCLUDE], origin: 'default' },
      exclude:
        quality?.exclude != null
          ? { values: toStringArray(quality.exclude), origin: 'config' }
          : { values: [], origin: 'default' },
      redact:
        quality?.redact != null
          ? { values: [...quality.redact], origin: 'config' }
          : { values: [], origin: 'default' },
      trials: quality?.defaults?.trials != null ? explicit(quality.defaults.trials) : fromDefault(DEFAULT_QUALITY_TRIALS),
      concurrency:
        quality?.defaults?.concurrency != null
          ? explicit(quality.defaults.concurrency)
          : fromDefault(DEFAULT_QUALITY_CONCURRENCY),
      timeoutMs:
        quality?.defaults?.timeoutMs != null
          ? explicit(quality.defaults.timeoutMs)
          : fromDefault(DEFAULT_QUALITY_TIMEOUT_MS),
      replay: quality?.defaults?.replay != null ? explicit(quality.defaults.replay) : fromDefault(DEFAULT_QUALITY_REPLAY),
    },
    generation: {
      autoEscape: generation?.autoEscape != null ? explicit(generation.autoEscape) : fromDefault(true),
      securityWarnings:
        generation?.securityWarnings != null
          ? explicit(generation.securityWarnings)
          : fromDefault(process.env.NODE_ENV !== 'production'),
      tokenizer: presence(generation?.tokenizer != null),
      middleware: presence(generation?.middleware != null),
    },
    indexer: {
      trust: indexer?.trust?.mode != null ? explicit(indexer.trust.mode) : fromDefault(DEFAULT_INDEXER_TRUST),
      extensions:
        indexer?.extensions && indexer.extensions.length > 0
          ? { values: indexer.extensions.map((extension) => extension.package), origin: 'config' }
          : { values: [], origin: 'default' },
    },
    observability: {
      enabled: observability?.enabled != null ? explicit(observability.enabled) : fromDefault(true),
      serverUrl: observability?.serverUrl != null ? explicit(observability.serverUrl) : { value: 'none', origin: 'none' },
      transport: presence(observability?.transport != null),
    },
    devtools: {
      serverUrl: devtools?.serverUrl != null ? explicit(devtools.serverUrl) : { value: 'none', origin: 'none' },
      bridge: presence(devtools?.bridge != null),
    },
    persistence: {
      store: presence(cfg?.persistence?.store != null),
    },
    lint: {
      profile: lint?.profile != null ? explicit(lint.profile) : fromDefault(DEFAULT_LINT_PROFILE),
      rules: lintRulesSetting(lint?.rules),
    },
    plugins:
      cfg?.plugins && cfg.plugins.length > 0
        ? { values: cfg.plugins.map((plugin) => plugin.name), origin: 'config' }
        : { values: [], origin: 'default' },
    discovered: {
      definitions: model.definitions.length,
      relations: model.relations.length,
      evaluations: model.definitions.filter((definition) => definition.kind === 'evaluation').length,
      definitionKinds,
    },
    diagnostics: inspectDiagnostics(configDiagnostics, model.diagnostics),
  }
}

function configFileSummary(
  loaded: Awaited<ReturnType<typeof loadProjectConfig>>['loaded'],
  configPath: string | undefined,
  diagnostics: readonly IndexDiagnostic[],
): ProjectConfigInspect['configFile'] {
  const origin: ProjectConfigFileOrigin = !loaded.configFile ? 'none' : configPath ? '--config' : 'discovered'
  const status: ProjectConfigFileStatus = !loaded.configFile
    ? 'missing'
    : loaded.importFailed
      ? 'import-failed'
      : loaded.crux
        ? 'loaded'
        : 'unrecognized'
  const importFailure = diagnostics.find((diagnostic) => diagnostic.code === 'index.config_import_failed')
  return {
    ...(loaded.configFile ? { path: loaded.configFile } : {}),
    status,
    origin,
    ...(status === 'import-failed' && importFailure ? { error: importFailure.message } : {}),
  }
}

function lintRulesSetting(rules: Record<string, unknown> | undefined): ProjectConfigSetting {
  const count = rules ? Object.keys(rules).length : 0
  return count > 0 ? explicit(count) : fromDefault(0)
}

// Merge config-load diagnostics with the discovery model's diagnostics, dropping
// the source-only marker (this view did import the config) and de-duplicating.
function inspectDiagnostics(
  configDiagnostics: readonly IndexDiagnostic[],
  modelDiagnostics: ProjectConfigInspect['diagnostics'],
): ProjectConfigInspect['diagnostics'] {
  const seen = new Set<string>()
  const merged: { severity: string; code: string; message: string }[] = []
  const push = (severity: string, code: string, message: string) => {
    if (code === 'project_model.source_only_discovery') return
    const key = `${severity}:${code}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    merged.push({ severity, code, message })
  }
  for (const diagnostic of configDiagnostics) push(diagnostic.severity, diagnostic.code, diagnostic.message)
  for (const diagnostic of modelDiagnostics) push(diagnostic.severity, diagnostic.code, diagnostic.message)
  return merged
}
