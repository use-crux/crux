import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  ProjectDefinition,
  ProjectRelation,
} from '@use-crux/core/project-index'
import type {
  StaticImportRecord,
  StaticInitializerRecord,
  StaticSourceMatch,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontendIdentity,
} from '../../syntax/record'
import { loadIndexerExtensionReferences } from '../../../extensions/loading/references'
import {
  createIndexerExtensionRuntime,
  type ExtensionRuntimeManifest,
  type ExtensionRuleInput,
  type StaticExtractionResult,
} from '../../../extensions/runtime/engine'
import {
  nativeFinalizeFactsFromExtractionResults,
  nativeFinalizeFactsFromRuleOutput,
  type StaticExtensionNativeFinalizeFacts,
} from './host-facts'
import type {
  ExtensionIdentity,
  IndexDependency,
  IndexerExtension,
  IndexerExtensionConfig,
} from '../../../extensions/public-contract/types'
import { STATIC_INDEX_COMPILER_PROTOCOL_VERSION } from '../../protocol/identity'

/** Phase 8 TypeScript host method names. */
export type StaticExtensionHostMethod =
  | 'loadStaticExtensionHostManifest'
  | 'extractStaticEvidenceBatch'
  | 'checkStaticRules'

/** Machine-readable reason the Static Index run needs the Node compatibility host. */
export type StaticExtensionHostNodeReason =
  | 'typescript-extension-extractors'
  | 'typescript-rules'
  | 'compatibility-evidence'
  | 'extension-host-diagnostics'

/** Node host startup decision reported to Go benchmarks and diagnostics. */
export interface StaticExtensionHostNodeReport {
  readonly started: boolean
  readonly reasons: readonly StaticExtensionHostNodeReason[]
}

/** Input for loading the data-only manifest used by Static Index planning. */
export interface LoadStaticExtensionHostManifestInput {
  /** Project root used as the package resolution base when `config` references packages. */
  readonly root: string
  /** Inert indexer config data from `config({ indexer })`, if package loading is needed. */
  readonly config?: IndexerExtensionConfig
  /** Already loaded trusted extension manifests for in-process callers and tests. */
  readonly extensions?: readonly IndexerExtension[]
  /** Native compiler protocol version supported by the caller. */
  readonly nativeCompilerProtocolVersion: typeof STATIC_INDEX_COMPILER_PROTOCOL_VERSION
}

/** Common trusted-extension input accepted by in-process host methods. */
export interface StaticExtensionHostRuntimeInput {
  /** Project root used as the package resolution base when `config` references packages. */
  readonly root: string
  /** Inert indexer config data from `config({ indexer })`, if package loading is needed. */
  readonly config?: IndexerExtensionConfig
  /** Already loaded trusted extension manifests for in-process callers and tests. */
  readonly extensions?: readonly IndexerExtension[]
}

/** Data returned by `loadStaticExtensionHostManifest`. */
export interface LoadStaticExtensionHostManifestResult {
  readonly method: 'loadStaticExtensionHostManifest'
  readonly root: string
  readonly nativeCompilerProtocolVersion: typeof STATIC_INDEX_COMPILER_PROTOCOL_VERSION
  readonly manifest: ExtensionRuntimeManifest
  /**
   * Complete static extraction cache identity for the Static Index compiler.
   *
   * Project-scoped worker hosts replace this with the same merged identity used by the TypeScript
   * planner. Direct calls expose the extension-runtime fragment for tests and in-process adapters.
   */
  readonly cacheInputs: readonly IndexDependency[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly node: StaticExtensionHostNodeReport
  readonly nativeOnlyEligible: boolean
  readonly nativeOnlyReasons: readonly StaticExtensionHostNodeReason[]
  /** Extension-provided rule descriptors, without running any rule checks. */
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
}

/** Exact TypeScript extractor selected by one native evidence job. */
export interface StaticExtensionEvidenceExtractor {
  /** Extension identity that owns the extractor. */
  readonly extension: ExtensionIdentity
  /** Extractor name inside the extension. */
  readonly name: string
}

/**
 * Data-only evidence job emitted by the native compiler for a TS extractor.
 *
 * `evidence` is a normalized syntax match and not a parser node. It may come
 * from Rust/Oxc or a TypeScript compatibility frontend, but the host treats it
 * as immutable JSON evidence either way.
 */
export interface StaticExtensionEvidenceJob {
  /** Stable job id used to correlate host results with native finalization input. */
  readonly id: string
  /** Extractor that should run for this evidence item. */
  readonly extractor: StaticExtensionEvidenceExtractor
  /** Absolute source file path that owns the evidence item. */
  readonly file: string
  /** Hash of the exact source text used by the native compiler. */
  readonly sourceHash: string
  /** Normalized syntax evidence for the matched call, constructor, or object. */
  readonly evidence: StaticSourceMatch
  /** Static import bindings visible to source-ref readers. */
  readonly imports?: readonly StaticImportRecord[]
  /** Top-level local initializers visible to record-backed readers. */
  readonly localInitializers?: readonly StaticInitializerRecord[]
  /** Frontend identity that produced the evidence. Defaults to a host evidence identity. */
  readonly frontend?: StaticSyntaxFrontendIdentity
}

/** Input for executing a batch of TS extractors from native-provided evidence. */
export interface ExtractStaticEvidenceBatchInput extends StaticExtensionHostRuntimeInput {
  /** Native compiler evidence jobs selected from declared extension interests. */
  readonly jobs: readonly StaticExtensionEvidenceJob[]
}

/** One extractor result produced for a native evidence job. */
export interface ExtractStaticEvidenceBatchItemResult {
  readonly jobId: string
  readonly result: StaticExtractionResult
}

/** Data returned by `extractStaticEvidenceBatch`. */
export interface ExtractStaticEvidenceBatchResult {
  readonly method: 'extractStaticEvidenceBatch'
  readonly root: string
  readonly results: readonly ExtractStaticEvidenceBatchItemResult[]
  readonly facts: StaticExtensionNativeFinalizeFacts
  readonly diagnostics: readonly IndexDiagnostic[]
}

/** Resolved graph facts passed to TypeScript index rules. */
export interface StaticRuleGraphInput {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

/** Input for executing TS rules over native-finalized graph facts. */
export interface CheckStaticRulesInput extends StaticExtensionHostRuntimeInput {
  readonly graph: StaticRuleGraphInput
  readonly availableFacts?: ExtensionRuleInput['availableFacts']
}

/** Data returned by `checkStaticRules`. */
export interface CheckStaticRulesResult {
  readonly method: 'checkStaticRules'
  readonly root: string
  readonly outputs: readonly IndexLintFinding[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
  readonly facts: StaticExtensionNativeFinalizeFacts
}

/**
 * Loads trusted TypeScript extension manifests for Static Index planning.
 *
 * The result is intentionally data-only: extension identities, extractor interests, relation specs,
 * rule descriptors, cache inputs, diagnostics, and host-start reasons. It does not parse project
 * source files or expose TypeScript/Oxc AST state.
 */
export async function loadStaticExtensionHostManifest(
  input: LoadStaticExtensionHostManifestInput,
): Promise<LoadStaticExtensionHostManifestResult> {
  const { runtime, diagnostics } = await createStaticExtensionHostRuntime(input)
  const resultDiagnostics = [...diagnostics, ...runtime.manifest.diagnostics]
  const reasons = hostNodeReasons(runtime.manifest, resultDiagnostics)

  return {
    method: 'loadStaticExtensionHostManifest',
    root: input.root,
    nativeCompilerProtocolVersion: input.nativeCompilerProtocolVersion,
    manifest: runtime.manifest,
    cacheInputs: runtime.manifest.cacheInputs,
    diagnostics: resultDiagnostics,
    node: {
      started: reasons.length > 0,
      reasons,
    },
    nativeOnlyEligible:
      reasons.length === 0 && runtime.manifest.staticHost.nativeOnlyEligible,
    nativeOnlyReasons: reasons,
    ruleDescriptors: runtime.ruleDescriptors,
  }
}

/**
 * Runs TypeScript extractors against native-provided static evidence.
 *
 * The host reconstructs the existing record-backed extractor context from
 * JSON-safe evidence, runs only the selected extractor for each job, and
 * returns inert fact data for native relation finalization.
 */
export async function extractStaticEvidenceBatch(
  input: ExtractStaticEvidenceBatchInput,
): Promise<ExtractStaticEvidenceBatchResult> {
  const { runtime, diagnostics } = await createStaticExtensionHostRuntime(input)
  const results = input.jobs.map((job) => ({
    jobId: job.id,
    result: runtime.extractStaticRecord({
      root: input.root,
      record: evidenceRecord(job),
      match: job.evidence,
      onlyExtractors: [
        {
          extension: job.extractor.extension.name,
          extractor: job.extractor.name,
        },
      ],
    }),
  }))

  return {
    method: 'extractStaticEvidenceBatch',
    root: input.root,
    results,
    facts: nativeFinalizeFactsFromExtractionResults(
      results.map((item) => item.result),
    ),
    diagnostics: [...diagnostics, ...runtime.manifest.diagnostics],
  }
}

/**
 * Runs TypeScript index rules over native-finalized graph facts.
 *
 * Rules see definitions and relations only after native finalization has
 * performed relation policy validation and canonical edge construction.
 */
export async function checkStaticRules(
  input: CheckStaticRulesInput,
): Promise<CheckStaticRulesResult> {
  const { runtime, diagnostics } = await createStaticExtensionHostRuntime(input)
  const ruleResult = runtime.checkRules({
    definitions: input.graph.definitions,
    relations: input.graph.relations,
    ...(input.availableFacts ? { availableFacts: input.availableFacts } : {}),
  })

  return {
    method: 'checkStaticRules',
    root: input.root,
    outputs: ruleResult.outputs,
    diagnostics: [...diagnostics, ...ruleResult.diagnostics],
    ruleDescriptors: runtime.ruleDescriptors,
    facts: nativeFinalizeFactsFromRuleOutput({
      lintFindings: ruleResult.outputs,
      ruleDescriptors: runtime.ruleDescriptors,
      diagnostics: [...diagnostics, ...ruleResult.diagnostics],
    }),
  }
}

async function createStaticExtensionHostRuntime(
  input: StaticExtensionHostRuntimeInput,
): Promise<{
  readonly runtime: ReturnType<typeof createIndexerExtensionRuntime>
  readonly diagnostics: readonly IndexDiagnostic[]
}> {
  const loaded = input.config
    ? await loadIndexerExtensionReferences({
        root: input.root,
        config: input.config,
      })
    : { extensions: [], diagnostics: [] as readonly IndexDiagnostic[] }
  const extensions = [
    ...(input.extensions ?? []),
    ...loaded.extensions.map((entry) => entry.extension),
  ]
  return {
    runtime: createIndexerExtensionRuntime({ extensions }),
    diagnostics: loaded.diagnostics,
  }
}

function evidenceRecord(
  job: StaticExtensionEvidenceJob,
): StaticSyntaxFileRecord {
  return {
    schemaVersion: 1,
    frontend: job.frontend ?? {
      name: 'typescript',
      version: 'static-extension-host-evidence',
    },
    file: job.file,
    relativePath: job.file,
    sourceHash: job.sourceHash,
    imports: job.imports ?? [],
    matches: [job.evidence],
    localInitializers: job.localInitializers ?? [],
    diagnostics: [],
  }
}

function hostNodeReasons(
  manifest: ExtensionRuntimeManifest,
  diagnostics: readonly IndexDiagnostic[],
): readonly StaticExtensionHostNodeReason[] {
  const reasons: StaticExtensionHostNodeReason[] = []
  if (manifest.staticHost.requiresTypeScriptHostForExtensions)
    reasons.push('typescript-extension-extractors')
  if (manifest.staticHost.requiresTypeScriptHostForRules)
    reasons.push('typescript-rules')
  if (manifest.staticHost.requiresCompatibilityEvidence)
    reasons.push('compatibility-evidence')
  if (diagnostics.length > 0) reasons.push('extension-host-diagnostics')
  return reasons
}
