import type { ProjectModelResolutionMode } from '@crux/core/project-index'

/** How a config value was resolved, shown as an origin tag in the CLI. */
export type ProjectConfigOrigin = 'default' | 'config' | 'package.json' | 'set' | 'none'

/** Where the resolver located the config file. */
export type ProjectConfigFileOrigin = 'discovered' | '--config' | 'none'

/** Resolution status of the config file once import was attempted or skipped. */
export type ProjectConfigFileStatus = 'loaded' | 'missing' | 'import-failed' | 'unrecognized' | 'source-only'

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
  readonly experimental: {
    readonly indexer: {
      readonly native: ProjectConfigSetting
      readonly nativeEngine: ProjectConfigSetting
      readonly tsserverPath: ProjectConfigSetting
    }
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

/** Options for {@link import('./project-config-inspect').inspectProjectConfig}. */
export interface InspectProjectConfigOptions {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  /** Defaults to `config-policy`; source-only is used by worker fallback paths. */
  readonly resolutionMode?: ProjectModelResolutionMode
}
