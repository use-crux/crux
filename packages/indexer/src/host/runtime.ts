/**
 * Runtime Index host facade.
 *
 * Runtime-rich indexing emits a runtime patch from config/runtime metadata
 * without invoking bundled source projection. This host-only entry point stays
 * separate from the root SDK surface.
 *
 * @module
 */

import { resolve } from 'node:path'
import type { ProjectIdentity, ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { createRuntimeError, type InProcessRuntimeEngineDefinition } from '@use-crux/core/runtime'
import { indexDefinitionsFromSnapshot, serializeIndex } from '@use-crux/core/project-index/serializers'
import { loadProjectConfig } from '../indexer/config'
import { discoverRuntimeEvalDefinitions } from '../indexer/eval-discovery'
import { evalGlobs } from '../indexer/files'
import type { IndexPatch } from '../indexer/patches'
export {
  decodeRuntimeArtifactManifest,
  RuntimeArtifactManifestDecodeError,
} from '../indexer/runtime-artifacts/manifest-codec'

/** Host-only options for the runtime-rich worker phase. */
export interface IndexProjectRuntimeHostOptions {
  /** Project root used for config and runtime policy loading. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by the local runtime. */
  readonly projectName?: string
  /** Source/native snapshot that this runtime phase enriches. */
  readonly previousIndex?: ProjectIndexSnapshot
}

/** Options for loading the configured self-hosted Runtime worker definition. */
export interface LoadRuntimeWorkerHostOptions {
  /** Project root containing the selected Crux config. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless absolute. */
  readonly configPath?: string
}

/** Load the provider-neutral in-process Runtime definition selected by project config. */
export async function loadRuntimeWorkerHost(
  options: LoadRuntimeWorkerHostOptions,
): Promise<InProcessRuntimeEngineDefinition> {
  const result = await loadProjectConfig(resolve(options.root), options.configPath, 'runtime-rich')
  const runtime = result.loaded.crux?.config.runtime
  if (runtime?.kind === 'in-process' && runtime.store.maintenanceOwnership) return runtime
  const importFailed = result.loaded.configFile && !result.loaded.crux
  const ownershipMissing = runtime?.kind === 'in-process'
  throw createRuntimeError({
    code: importFailed
      ? 'RUNTIME_ARTIFACT_MANIFEST_INVALID'
      : ownershipMissing
        ? 'CAPABILITY_MISSING'
        : 'RUNTIME_REQUIRED',
    whatFailed: importFailed
      ? `Crux could not load the Runtime host from \`${result.loaded.configFile}\`.`
      : ownershipMissing
        ? 'The configured Runtime store cannot coordinate worker ownership across processes.'
      : 'Crux could not resolve an in-process Runtime host for this worker.',
    why: importFailed
      ? 'The selected config failed to import or did not export a Crux config instance.'
      : ownershipMissing
        ? 'Exactly one execution worker requires a durable maintenance ownership port before it can admit work.'
      : 'The worker command requires `runtime: node({ store: postgres() })` in project config.',
    whatStillWorks: 'Generated artifacts and host-bound Runtime entries remain unchanged.',
    nextStep: 'Configure `runtime: node({ store: postgres() })`, fix config imports, then retry `crux runtime worker`.',
  })
}

/**
 * Builds the host runtime phase without invoking bundled TypeScript source projection.
 *
 * The runtime worker may import the selected config in `runtime-rich` mode, but
 * authored source extraction is owned by the native Static Index pipeline. This
 * keeps the phase useful for config-derived runtime metadata while avoiding a
 * hidden fallback to the removed bundled TypeScript projectors.
 */
export async function indexProjectRuntimeForHost(options: IndexProjectRuntimeHostOptions): Promise<IndexPatch> {
  const root = resolve(options.root)
  const startedAt = new Date().toISOString()
  const { loaded, diagnostics: configDiagnostics, sources } = await loadProjectConfig(
    root,
    options.configPath,
    'runtime-rich',
  )
  const index = serializeIndex(
    loaded.crux?.prompts ? [...loaded.crux.prompts] : [],
    loaded.crux?.contexts ? [...loaded.crux.contexts] : [],
    undefined,
  )
  const derived = indexDefinitionsFromSnapshot(index)
  const evals = await discoverRuntimeEvalDefinitions(root, evalGlobs(loaded), sources)
  const diagnostics = [...derived.diagnostics, ...configDiagnostics, ...evals.diagnostics]

  return {
    schemaVersion: 1,
    phase: 'runtime',
    project: runtimeProjectIdentity({
      root,
      projectName: options.projectName,
      previousIndex: options.previousIndex,
      configFile: loaded.configFile,
      runtimeConfigured: loaded.importFailed ? undefined : Boolean(loaded.crux?.config.runtime),
    }),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'degraded' : 'ok',
    facts: {
      prompts: index.prompts,
      contexts: index.contexts,
      tools: index.tools,
      lint: loaded.lint,
      definitions: [...derived.definitions, ...evals.definitions],
      relations: [...derived.relations, ...evals.relations],
      diagnostics,
      lintFindings: [],
      ruleDescriptors: [],
      sources: evals.sources,
    },
  }
}

function runtimeProjectIdentity(input: {
  readonly root: string
  readonly projectName?: string
  readonly previousIndex?: ProjectIndexSnapshot
  readonly configFile?: string
  readonly runtimeConfigured?: boolean
}): ProjectIdentity {
  return {
    ...input.previousIndex?.project,
    root: input.root,
    ...(input.projectName ? { name: input.projectName } : {}),
    ...(input.configFile ? { configFile: input.configFile } : {}),
    ...(input.runtimeConfigured === undefined ? {} : { runtimeConfigured: input.runtimeConfigured }),
  }
}
