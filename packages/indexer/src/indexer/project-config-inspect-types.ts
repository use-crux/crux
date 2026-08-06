import type { ProjectModelResolutionMode } from "@use-crux/core/project-index";

/** How a config value was resolved, shown as an origin tag in the CLI. */
export type ProjectConfigOrigin =
  | "default"
  | "config"
  | "package.json"
  | "set"
  | "none";

/** Where the resolver located the config file. */
export type ProjectConfigFileOrigin = "discovered" | "--config" | "none";

/** Resolution status of the config file once import was attempted or skipped. */
export type ProjectConfigFileStatus =
  | "loaded"
  | "missing"
  | "import-failed"
  | "unrecognized"
  | "source-only";

/** One resolved scalar config value plus its origin. */
export interface ProjectConfigSetting {
  readonly value: string;
  readonly origin: ProjectConfigOrigin;
}

/** One resolved list config value plus its origin. */
export interface ProjectConfigList {
  readonly values: readonly string[];
  readonly origin: ProjectConfigOrigin;
}

/** The effective configuration as `crux config inspect` renders it. */
export interface ProjectConfigInspect {
  readonly root: string;
  readonly packageName?: string;
  readonly configFile: {
    readonly path?: string;
    readonly status: ProjectConfigFileStatus;
    readonly origin: ProjectConfigFileOrigin;
    readonly error?: string;
  };
  readonly generation: {
    readonly autoEscape: ProjectConfigSetting;
    readonly securityWarnings: ProjectConfigSetting;
    readonly tokenizer: ProjectConfigSetting;
    readonly middleware: ProjectConfigSetting;
  };
  readonly indexer: {
    readonly trust: ProjectConfigSetting;
    readonly extensions: ProjectConfigList;
  };
  readonly experimental: {
    readonly indexer: {
      readonly native: ProjectConfigSetting;
      readonly nativeEngine: ProjectConfigSetting;
      readonly tsserverPath: ProjectConfigSetting;
    };
  };
  readonly observability: {
    readonly enabled: ProjectConfigSetting;
    readonly serverUrl: ProjectConfigSetting;
    readonly token: ProjectConfigSetting;
    readonly transport: ProjectConfigSetting;
  };
  readonly devtools: {
    readonly serverUrl: ProjectConfigSetting;
    readonly bridge: ProjectConfigSetting;
  };
  readonly persistence: {
    /** Whether the standard `config.storage.records` capability is bound. */
    readonly store: ProjectConfigSetting;
  };
  readonly lint: {
    readonly profile: ProjectConfigSetting;
    readonly rules: ProjectConfigSetting;
  };
  readonly plugins: ProjectConfigList;
  /** Config-import Project Model counts, not the compiled Project Index. */
  readonly discovered: {
    readonly scope: "config-model";
    readonly definitions: number;
    readonly relations: number;
    readonly evals: number;
    readonly definitionKinds: Readonly<Record<string, number>>;
  };
  readonly diagnostics: readonly {
    readonly severity: string;
    readonly code: string;
    readonly message: string;
  }[];
}

/** Options for {@link import('./project-config-inspect').inspectProjectConfig}. */
export interface InspectProjectConfigOptions {
  readonly root: string;
  readonly configPath?: string;
  readonly projectName?: string;
  /** Defaults to `config-policy`; source-only is used by worker fallback paths. */
  readonly resolutionMode?: ProjectModelResolutionMode;
}
