import type { ProjectModelResolutionMode } from '@crux/core/project-index'
import { loadProjectConfig } from '../../../config'
import { applyIndexLintConfig } from '../../../lints/config'
import { indexLintFindings } from '../../../lints/findings'
import { builtInIndexRuleDescriptors } from '../../../lints/rules'
import { applyIndexLintSuppressions } from '../../../lints/suppressions'
import {
  checkStaticRules,
  extractStaticEvidenceBatch,
  loadStaticExtensionHostManifest,
  type CheckStaticRulesInput,
  type CheckStaticRulesResult,
  type ExtractStaticEvidenceBatchInput,
  type ExtractStaticEvidenceBatchResult,
  type LoadStaticExtensionHostManifestInput,
  type LoadStaticExtensionHostManifestResult,
  type StaticExtensionHostRuntimeInput,
} from './host'
import type { StaticExtensionNativeFinalizeFacts } from './host-facts'

/** Shared project config inputs for worker-hosted static extension calls. */
export interface StaticExtensionWorkerProjectInput {
  /** Project root used for config loading and extension package resolution. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Config loading mode used to resolve inert indexer extension settings. */
  readonly resolutionMode?: ProjectModelResolutionMode
}

/** Worker request for loading a data-only static extension host manifest. */
export interface LoadStaticExtensionHostManifestForProjectInput extends Pick<
  StaticExtensionWorkerProjectInput,
  'root' | 'configPath'
> {
  /** Native compiler protocol version supported by the caller. */
  readonly nativeCompilerProtocolVersion: LoadStaticExtensionHostManifestInput['nativeCompilerProtocolVersion']
}

/** Worker request for executing TypeScript extractors from native evidence. */
export interface ExtractStaticEvidenceBatchForProjectInput extends StaticExtensionWorkerProjectInput {
  /** Native compiler evidence jobs selected from declared extension interests. */
  readonly jobs: ExtractStaticEvidenceBatchInput['jobs']
}

/** Worker request for executing TypeScript index rules over native graph facts. */
export interface CheckStaticRulesForProjectInput extends StaticExtensionWorkerProjectInput {
  /** Native-finalized definitions and relations supplied to TypeScript rules. */
  readonly graph: CheckStaticRulesInput['graph']
  /** Optional auxiliary facts made available to rule implementations. */
  readonly availableFacts?: CheckStaticRulesInput['availableFacts']
  /** Source files scanned for Crux lint suppression directives. */
  readonly files?: readonly string[]
  /**
   * When true, TypeScript executes extension rules only and returns raw lint
   * facts. Native finalization owns built-in rules, config filtering, and
   * suppression handling for the merged lint set.
   */
  readonly nativeLintFinalize?: boolean
}

/**
 * Loads the project-scoped static extension host manifest for native static planning.
 *
 * This worker boundary imports no project source and performs no syntax/file/cache planning. It
 * only asks config loading for source-only inert indexer settings, loads configured trusted
 * extensions through the static host runtime, and returns JSON-safe manifest data.
 */
export async function loadStaticExtensionHostManifestForProject(
  input: LoadStaticExtensionHostManifestForProjectInput,
): Promise<LoadStaticExtensionHostManifestResult> {
  const loaded = await loadProjectConfig(input.root, input.configPath, 'source-only')
  const result = await loadStaticExtensionHostManifest({
    root: input.root,
    config: loaded.loaded.indexer,
    nativeCompilerProtocolVersion: input.nativeCompilerProtocolVersion,
  })
  return {
    ...result,
    diagnostics: [...loaded.diagnostics, ...result.diagnostics],
  }
}

/**
 * Executes TypeScript static extractors for a project-scoped worker request.
 *
 * The worker owns config loading so Go can send JSON-safe evidence jobs without
 * importing user code or reconstructing extension manifests itself.
 */
export async function extractStaticEvidenceBatchForProject(
  input: ExtractStaticEvidenceBatchForProjectInput,
): Promise<ExtractStaticEvidenceBatchResult> {
  const runtimeInput = await staticExtensionRuntimeInputForProject(input)
  const result = await extractStaticEvidenceBatch({
    ...runtimeInput,
    jobs: input.jobs,
  })
  return {
    ...result,
    diagnostics: [...runtimeInput.configDiagnostics, ...result.diagnostics],
  }
}

/**
 * Executes TypeScript static rules for a project-scoped worker request.
 *
 * Rules run after native finalization has produced the graph shape they already
 * consume in the JavaScript compiler path.
 */
export async function checkStaticRulesForProject(
  input: CheckStaticRulesForProjectInput,
): Promise<CheckStaticRulesResult> {
  const runtimeInput = await staticExtensionRuntimeInputForProject(input)
  const extensionResult = await checkStaticRules({
    ...runtimeInput,
    graph: input.graph,
    ...(input.availableFacts ? { availableFacts: input.availableFacts } : {}),
  })
  const diagnostics = [...runtimeInput.configDiagnostics, ...extensionResult.diagnostics]
  if (input.nativeLintFinalize) {
    return {
      ...extensionResult,
      diagnostics,
      facts: projectRuleFinalizeFacts({
        lintFindings: extensionResult.outputs,
        diagnostics,
      }),
    }
  }

  const ruleDescriptors = [...builtInIndexRuleDescriptors(), ...extensionResult.ruleDescriptors]
  const rawFindings = [...indexLintFindings(input.graph), ...extensionResult.outputs]
  const outputs = applyIndexLintConfig({
    config: runtimeInput.lint,
    configFile: runtimeInput.configFile,
    diagnostics,
    ruleDescriptors,
    findings: applyIndexLintSuppressions({
      files: input.files ?? graphSourceFiles(input.graph),
      findings: rawFindings,
      diagnostics,
      ruleDescriptors,
    }),
  })
  return {
    ...extensionResult,
    outputs,
    diagnostics,
    ruleDescriptors,
    facts: projectRuleFinalizeFacts({
      lintFindings: outputs,
      diagnostics,
    }),
  }
}

async function staticExtensionRuntimeInputForProject(input: StaticExtensionWorkerProjectInput): Promise<
  StaticExtensionHostRuntimeInput & {
    readonly configDiagnostics: Awaited<ReturnType<typeof loadProjectConfig>>['diagnostics']
    readonly configFile?: string
    readonly lint: Awaited<ReturnType<typeof loadProjectConfig>>['loaded']['lint']
  }
> {
  const loaded = await loadProjectConfig(input.root, input.configPath, input.resolutionMode ?? 'source-only')
  return {
    root: input.root,
    config: loaded.loaded.indexer,
    configDiagnostics: loaded.diagnostics,
    configFile: loaded.loaded.configFile,
    lint: loaded.loaded.lint,
  }
}

function projectRuleFinalizeFacts(input: {
  readonly lintFindings: CheckStaticRulesResult['outputs']
  readonly diagnostics: CheckStaticRulesResult['diagnostics']
}): StaticExtensionNativeFinalizeFacts {
  return {
    ...(input.lintFindings.length ? { lintFindings: input.lintFindings } : {}),
    ...(input.diagnostics.length ? { diagnostics: input.diagnostics } : {}),
  }
}

function graphSourceFiles(graph: CheckStaticRulesInput['graph']): readonly string[] {
  return [
    ...new Set(
      [
        ...graph.definitions.map((definition) => definition.source?.file),
        ...graph.relations.map((relation) => relation.source?.file),
      ].filter((file): file is string => typeof file === 'string' && file.length > 0),
    ),
  ].sort()
}
