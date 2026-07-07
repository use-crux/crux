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
import { indexDefinitionsFromSnapshot, serializeIndex } from '@use-crux/core/project-index/serializers'
import { loadProjectConfig } from '../indexer/config'
import type { IndexPatch } from '../indexer/patches'

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
  const diagnostics = [...derived.diagnostics, ...configDiagnostics]

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
      definitions: derived.definitions,
      relations: derived.relations,
      diagnostics,
      lintFindings: [],
      ruleDescriptors: [],
      sources,
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
