/**
 * Effective-configuration read model for `crux config inspect`.
 *
 * Unlike {@link resolveProjectModel}, which describes what source discovery can
 * see without importing user modules, this resolver imports the project's
 * `crux.config.ts` in inert `CRUX_INDEX=1` mode (no runtime side effects) and
 * renders the effective {@link CruxConfig}: every domain `config()` accepts, with
 * each value tagged by where it came from — an explicit config value, a built-in
 * default, package metadata, or the presence of a non-serializable binding
 * (record store, tokenizer, middleware, transport).
 *
 * It is a representation of configuration, not of authored primitives. A compact
 * discovery summary (definition/relation counts) is included for context; the
 * full authored index lives behind `crux index`.
 *
 * @module
 */

import type { CruxConfig } from "@use-crux/core";
import type { ProjectModelResolutionMode } from "@use-crux/core/project-index";
import type { IndexDiagnostic } from "@use-crux/core/project-index";
import { loadProjectConfig } from "./config";
import { withUserImportSession } from "./imports";
import { resolveProjectModel } from "./project-model";
import type {
  InspectProjectConfigOptions,
  ProjectConfigFileOrigin,
  ProjectConfigFileStatus,
  ProjectConfigInspect,
  ProjectConfigSetting,
} from "./project-config-inspect-types";
import { configInspectResolutionMode } from "./resolution-mode";
export type {
  InspectProjectConfigOptions,
  ProjectConfigFileOrigin,
  ProjectConfigFileStatus,
  ProjectConfigInspect,
  ProjectConfigList,
  ProjectConfigOrigin,
  ProjectConfigSetting,
} from "./project-config-inspect-types";

const DEFAULT_INDEXER_TRUST = "first-party-only";
const DEFAULT_LINT_PROFILE = "recommended";

const explicit = (value: unknown): ProjectConfigSetting => ({
  value: String(value),
  origin: "config",
});
const fromDefault = (value: unknown): ProjectConfigSetting => ({
  value: String(value),
  origin: "default",
});
const presence = (present: boolean): ProjectConfigSetting =>
  present ? { value: "set", origin: "set" } : { value: "none", origin: "none" };

/**
 * Resolve the effective Crux configuration for `crux config inspect`.
 *
 * Imports `crux.config.ts` in inert `CRUX_INDEX=1` mode to read explicit values,
 * merges built-in defaults for everything unset, and pairs each value with its
 * origin. Import failures degrade to an all-defaults view with an `import-failed`
 * config status and the error surfaced in diagnostics — inspection never throws
 * on a broken config.
 */
export async function inspectProjectConfig(
  options: InspectProjectConfigOptions,
): Promise<ProjectConfigInspect> {
  return withUserImportSession(
    () => inspectProjectConfigInSession(options),
    options.root,
  );
}

async function inspectProjectConfigInSession(
  options: InspectProjectConfigOptions,
): Promise<ProjectConfigInspect> {
  const resolutionMode = configInspectResolutionMode(options.resolutionMode);
  const { loaded, diagnostics: configDiagnostics } = await loadProjectConfig(
    options.root,
    options.configPath,
    resolutionMode,
  );
  const model = await resolveProjectModel({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    resolutionMode,
  });

  const cfg: CruxConfig | undefined = loaded.crux?.config;
  const packageName = model.packageName?.value;
  const generation = cfg?.generation;
  const indexer = cfg?.indexer;
  const experimental = cfg?.experimental;
  const observability = cfg?.observability;
  const devtools = cfg?.devtools;
  const lint = cfg?.lint;

  const definitionKinds: Record<string, number> = {};
  for (const definition of model.definitions) {
    definitionKinds[definition.kind] =
      (definitionKinds[definition.kind] ?? 0) + 1;
  }

  return {
    root: model.root.value,
    ...(packageName ? { packageName } : {}),
    configFile: configFileSummary(
      loaded,
      options.configPath,
      configDiagnostics,
    ),
    generation: {
      autoEscape:
        generation?.autoEscape != null
          ? explicit(generation.autoEscape)
          : fromDefault(true),
      securityWarnings:
        generation?.securityWarnings != null
          ? explicit(generation.securityWarnings)
          : fromDefault(process.env.NODE_ENV !== "production"),
      tokenizer: presence(generation?.tokenizer != null),
      middleware: presence(generation?.middleware != null),
    },
    indexer: {
      trust:
        indexer?.trust?.mode != null
          ? explicit(indexer.trust.mode)
          : fromDefault(DEFAULT_INDEXER_TRUST),
      extensions:
        indexer?.extensions && indexer.extensions.length > 0
          ? {
              values: indexer.extensions.map((extension) => extension.package),
              origin: "config",
            }
          : { values: [], origin: "default" },
    },
    experimental: {
      indexer: {
        native: experimentalIndexerNativeSetting(experimental),
        nativeEngine: experimentalIndexerNativeEngineSetting(experimental),
        tsserverPath: experimentalIndexerNativePathSetting(experimental),
      },
    },
    observability: {
      enabled:
        observability?.enabled != null
          ? explicit(observability.enabled)
          : fromDefault(true),
      serverUrl:
        observability?.serverUrl != null
          ? explicit(observability.serverUrl)
          : { value: "none", origin: "none" },
      token: presence(observability?.token != null),
      transport: presence(observability?.transport != null),
    },
    devtools: {
      serverUrl:
        devtools?.serverUrl != null
          ? explicit(devtools.serverUrl)
          : { value: "none", origin: "none" },
      bridge: presence(devtools?.bridge != null),
    },
    persistence: {
      store: presence(cfg?.storage?.records != null),
    },
    lint: {
      profile:
        lint?.profile != null
          ? explicit(lint.profile)
          : fromDefault(DEFAULT_LINT_PROFILE),
      rules: lintRulesSetting(lint?.rules),
    },
    plugins:
      cfg?.plugins && cfg.plugins.length > 0
        ? { values: cfg.plugins.map((plugin) => plugin.name), origin: "config" }
        : { values: [], origin: "default" },
    discovered: {
      definitions: model.definitions.length,
      relations: model.relations.length,
      evals: model.definitions.filter(
        (definition) => definition.kind === "eval",
      ).length,
      definitionKinds,
    },
    diagnostics: inspectDiagnostics(
      resolutionMode,
      configDiagnostics,
      model.diagnostics,
    ),
  };
}

function configFileSummary(
  loaded: Awaited<ReturnType<typeof loadProjectConfig>>["loaded"],
  configPath: string | undefined,
  diagnostics: readonly IndexDiagnostic[],
): ProjectConfigInspect["configFile"] {
  const origin: ProjectConfigFileOrigin = !loaded.configFile
    ? "none"
    : configPath
      ? "--config"
      : "discovered";
  const status: ProjectConfigFileStatus = !loaded.configFile
    ? "missing"
    : loaded.importSkipped
      ? "source-only"
      : loaded.importFailed
        ? "import-failed"
        : loaded.crux
          ? "loaded"
          : "unrecognized";
  const importFailure = diagnostics.find(
    (diagnostic) => diagnostic.code === "index.config_import_failed",
  );
  return {
    ...(loaded.configFile ? { path: loaded.configFile } : {}),
    status,
    origin,
    ...(status === "import-failed" && importFailure
      ? { error: importFailure.message }
      : {}),
  };
}

function lintRulesSetting(
  rules: Record<string, unknown> | undefined,
): ProjectConfigSetting {
  const count = rules ? Object.keys(rules).length : 0;
  return count > 0 ? explicit(count) : fromDefault(0);
}

function experimentalIndexerNativeSetting(
  experimental: CruxConfig["experimental"],
): ProjectConfigSetting {
  const native = experimental?.indexer?.native;
  return native == null ? fromDefault(false) : explicit(native !== false);
}

function experimentalIndexerNativeEngineSetting(
  experimental: CruxConfig["experimental"],
): ProjectConfigSetting {
  const native = experimental?.indexer?.native;
  if (native == null || native === false)
    return { value: "none", origin: "none" };
  if (native === true || native.engine == null) return fromDefault("tsgo");
  return explicit(native.engine);
}

function experimentalIndexerNativePathSetting(
  experimental: CruxConfig["experimental"],
): ProjectConfigSetting {
  const native = experimental?.indexer?.native;
  return typeof native === "object" && native.tsserverPath
    ? explicit(native.tsserverPath)
    : { value: "none", origin: "none" };
}

// Merge config-load diagnostics with the discovery model's diagnostics, dropping
// the source-only marker (this view did import the config) and de-duplicating.
function inspectDiagnostics(
  resolutionMode: ProjectModelResolutionMode,
  configDiagnostics: readonly IndexDiagnostic[],
  modelDiagnostics: ProjectConfigInspect["diagnostics"],
): ProjectConfigInspect["diagnostics"] {
  const seen = new Set<string>();
  const merged: { severity: string; code: string; message: string }[] = [];
  const push = (severity: string, code: string, message: string) => {
    if (
      resolutionMode !== "source-only" &&
      code === "project_model.source_only_discovery"
    )
      return;
    const key = `${severity}:${code}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ severity, code, message });
  };
  for (const diagnostic of configDiagnostics)
    push(diagnostic.severity, diagnostic.code, diagnostic.message);
  for (const diagnostic of modelDiagnostics)
    push(diagnostic.severity, diagnostic.code, diagnostic.message);
  return merged;
}
