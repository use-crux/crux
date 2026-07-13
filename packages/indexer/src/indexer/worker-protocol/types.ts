/**
 * Versioned Project Index worker protocol contracts.
 *
 * The protocol streams durable patch facts as NDJSON events. Workers may use
 * TypeScript, native parsers, or later semantic backends internally, but the
 * process boundary stays fact-shaped rather than AST- or compiler-shaped.
 *
 * @module
 */

import type {
  ProjectModelProvenance,
  ResolvedProjectModel,
} from '@use-crux/core/project-index'
import type { IndexPatch, IndexPatchFacts, IndexPatchPhase } from '../patches'
import type { ProjectConfigInspect } from '../project-config-inspect'
import type { ProjectStaticIndexConfig } from '../static-index/config/inspect'
import type { ProjectStaticSyntaxPlan } from '../static-index/plan'
import type { StaticExtractionTimingName } from '../static/instrumentation'
import type { SemanticSourceProfileFile } from '../semantic/source-profile'
import type {
  CheckStaticRulesResult,
  ExtractStaticEvidenceBatchResult,
  LoadStaticExtensionHostManifestResult,
} from '../extensions'
import type { RuntimeArtifactGenerationResult } from '../runtime-artifacts'
import type { RuntimeOperationResult } from '../runtime-ops'
import type { SetupReport } from '@use-crux/core/setup'

/** Current Project Index worker stream protocol version. */
export const PROJECT_INDEX_WORKER_PROTOCOL_VERSION = 2 as const

type ArrayItem<T> = T extends readonly (infer TItem)[] ? TItem : never

/**
 * Producer identity attached to every fact envelope.
 *
 * The name/version pair is intentionally small so Go can validate provenance
 * without understanding TypeScript package internals.
 */
export interface ProjectIndexFactProducer {
  /** Package, worker, or backend name that produced the fact. */
  readonly name: string
  /** Stable producer version or build identity used for diagnostics. */
  readonly version: string
}

/** Evidence fidelity attached to streamed fact envelopes. */
export type ProjectIndexFactFidelity =
  | 'authoritative'
  | 'inferred'
  | 'best-effort'
  | 'runtime-observed'

/**
 * Typed mapping between `IndexPatchFacts` fields and streamed fact values.
 *
 * Array-valued patch fields stream one fact per element. Singleton patch fields
 * stream one envelope whose kind is the field name.
 */
export interface ProjectIndexPatchFactMap {
  readonly prompts: ArrayItem<NonNullable<IndexPatchFacts['prompts']>>
  readonly contexts: ArrayItem<NonNullable<IndexPatchFacts['contexts']>>
  readonly tools: ArrayItem<NonNullable<IndexPatchFacts['tools']>>
  readonly lint: NonNullable<IndexPatchFacts['lint']>
  readonly definitions: ArrayItem<NonNullable<IndexPatchFacts['definitions']>>
  readonly relations: ArrayItem<NonNullable<IndexPatchFacts['relations']>>
  readonly sourceRefs: ArrayItem<NonNullable<IndexPatchFacts['sourceRefs']>>
  readonly diagnostics: ArrayItem<NonNullable<IndexPatchFacts['diagnostics']>>
  readonly lintFindings: ArrayItem<NonNullable<IndexPatchFacts['lintFindings']>>
  readonly ruleDescriptors: ArrayItem<
    NonNullable<IndexPatchFacts['ruleDescriptors']>
  >
  readonly sources: ArrayItem<NonNullable<IndexPatchFacts['sources']>>
  readonly sourceGraph: NonNullable<IndexPatchFacts['sourceGraph']>
}

/** Fact kinds supported by the V2 patch stream. */
export type ProjectIndexPatchFactKind = keyof ProjectIndexPatchFactMap

/**
 * A fact envelope emitted by a Project Index worker.
 *
 * The generic parameter narrows `fact` from the envelope kind, giving worker
 * helpers precise inference without exposing raw compiler objects.
 */
export interface ProjectIndexFactEnvelopeFor<
  TKind extends ProjectIndexPatchFactKind,
> {
  /** Envelope schema version. */
  readonly schemaVersion: 1
  /** Stable identifier for this fact within the transaction. */
  readonly factId: string
  /** Patch fact field represented by this envelope. */
  readonly kind: TKind
  /** Index phase that produced the fact. */
  readonly phase: IndexPatchPhase
  /** Absolute project root from the transaction request. */
  readonly projectRoot: string
  /** Worker/backend that produced this fact. */
  readonly producer: ProjectIndexFactProducer
  /** Evidence fidelity for this fact at the phase boundary. */
  readonly fidelity: ProjectIndexFactFidelity
  /** JSON-safe provenance for the fact producer or runtime observation. */
  readonly provenance: ProjectModelProvenance
  /** JSON-safe Project Index fact payload. */
  readonly fact: ProjectIndexPatchFactMap[TKind]
}

/** Discriminated union of all Project Index fact envelopes. */
export type ProjectIndexFactEnvelope = {
  [TKind in ProjectIndexPatchFactKind]: ProjectIndexFactEnvelopeFor<TKind>
}[ProjectIndexPatchFactKind]

/** Patch metadata sent once per completed phase transaction. */
export type ProjectIndexPatchMetadata = Omit<IndexPatch, 'facts'>

/**
 * JSON artifact payloads emitted through the V2 worker protocol.
 *
 * These are not durable index facts and are therefore kept separate from
 * `ProjectIndexPatchFactMap`; callers still receive them through the same
 * versioned NDJSON boundary.
 */
export interface ProjectIndexArtifactMap {
  /** Source-discovery Project Model used by config and quality workflows. */
  readonly projectModel: ResolvedProjectModel
  /** Effective configuration read model rendered by `crux config inspect`. */
  readonly projectConfig: ProjectConfigInspect
  /** Executable-config fragment used before Go/Rust-owned Static Index planning. */
  readonly projectStaticIndexConfig: ProjectStaticIndexConfig
  /** Static syntax parsing plan consumed by native parser hosts. */
  readonly projectStaticSyntaxPlan: ProjectStaticSyntaxPlan
  /** Data-only extension runtime manifest loaded by the TypeScript static host. */
  readonly staticExtensionHostManifest: LoadStaticExtensionHostManifestResult
  /** TypeScript extractor facts produced from Static Index evidence jobs. */
  readonly staticExtensionEvidenceBatch: ExtractStaticEvidenceBatchResult
  /** TypeScript rule outputs produced from a native-finalized static graph. */
  readonly staticRuleCheck: CheckStaticRulesResult
  /** Runtime manifest and entry files written by `crux runtime generate`. */
  readonly runtimeArtifacts: RuntimeArtifactGenerationResult
  /** Runtime operation result emitted for Crux Local CLI commands. */
  readonly runtimeOperation: RuntimeOperationResult
  /** Aggregate project setup result emitted for `crux setup`. */
  readonly setupOperation: SetupReport
}

/** JSON artifact kinds supported by the V2 worker stream. */
export type ProjectIndexArtifactKind = keyof ProjectIndexArtifactMap

/** Base fields shared by every worker stream event. */
export interface ProjectIndexWorkerEventBase {
  /** Worker protocol version. */
  readonly protocolVersion: typeof PROJECT_INDEX_WORKER_PROTOCOL_VERSION
  /** Event type discriminator. */
  readonly type: string
  /** Transaction id that ties phase events together. */
  readonly transactionId: string
}

/** Opens a transactional index phase stream. */
export interface ProjectIndexPhaseStartEvent extends ProjectIndexWorkerEventBase {
  readonly type: 'phase:start'
  /** Index phase being streamed. */
  readonly phase: IndexPatchPhase
  /** Absolute project root for validation on the host side. */
  readonly root: string
  /** ISO timestamp from the patch start metadata. */
  readonly startedAt: string
}

/** Streams a contiguous batch of patch facts. */
export interface ProjectIndexFactBatchEvent extends ProjectIndexWorkerEventBase {
  readonly type: 'fact:batch'
  /** Zero-based contiguous sequence number. */
  readonly sequence: number
  /** Facts in this batch. */
  readonly facts: readonly ProjectIndexFactEnvelope[]
}

/** Streams compact semantic source-profile rows produced by the AST phase. */
export interface ProjectIndexSourceProfileBatchEvent extends ProjectIndexWorkerEventBase {
  readonly type: 'sourceProfile:batch'
  /** Zero-based contiguous sequence number. */
  readonly sequence: number
  /** Source profile rows in this batch. */
  readonly files: readonly SemanticSourceProfileFile[]
}

/** Summary emitted after a phase stream is complete. */
export interface ProjectIndexPhaseSummary {
  /** Number of fact envelopes emitted for the transaction. */
  readonly factCount: number
  /** Optional compiler phase timings for diagnostics and benchmarks. */
  readonly timings?: readonly ProjectIndexPhaseTiming[]
  /** Optional whole-run incremental planning decision attached to the final patch. */
  readonly decision?: unknown
  /** Optional whole-run incremental execution report attached to the final patch. */
  readonly report?: unknown
}

/** Aggregated worker phase timing emitted for diagnostics and benchmarks. */
export interface ProjectIndexPhaseTiming {
  /** Stable timing bucket name. */
  readonly name: StaticExtractionTimingName | string
  /** Sum of durations for all observations in this bucket. */
  readonly durationMs: number
  /** Number of observations in this bucket. */
  readonly count: number
}

/** Closes a successful transactional index phase stream. */
export interface ProjectIndexPhaseDoneEvent<
  TSummary extends ProjectIndexPhaseSummary = ProjectIndexPhaseSummary,
> extends ProjectIndexWorkerEventBase {
  readonly type: 'phase:done'
  /** Index phase that completed. */
  readonly phase: IndexPatchPhase
  /** Patch metadata excluding streamed facts. */
  readonly patch: ProjectIndexPatchMetadata
  /** Transaction summary for validation and telemetry. */
  readonly summary: TSummary
}

/** Reports a phase-level worker failure. */
export interface ProjectIndexPhaseErrorEvent extends ProjectIndexWorkerEventBase {
  readonly type: 'phase:error'
  /** Index phase that failed when known. */
  readonly phase?: IndexPatchPhase
  /** JSON-safe error payload. */
  readonly error: {
    readonly message: string
    readonly code?: string
  }
  /** Whether the worker intentionally degraded instead of crashing. */
  readonly degraded?: boolean
}

/**
 * Emits one complete JSON artifact.
 *
 * Small artifacts use a single event with `payload`. Large artifacts may be
 * preceded by `artifact:chunk` events and then use this event as the terminal
 * marker without `payload`.
 */
export interface ProjectIndexArtifactDoneEvent<
  TKind extends ProjectIndexArtifactKind = ProjectIndexArtifactKind,
> extends ProjectIndexWorkerEventBase {
  readonly type: 'artifact:done'
  /** Artifact kind represented by the payload. */
  readonly artifact: TKind
  /** Absolute project root for host-side identity validation. */
  readonly root: string
  /** JSON-safe artifact payload, omitted when prior chunks carried it. */
  readonly payload?: ProjectIndexArtifactMap[TKind]
}

/** Streams one base64-encoded JSON artifact payload chunk. */
export interface ProjectIndexArtifactChunkEvent<
  TKind extends ProjectIndexArtifactKind = ProjectIndexArtifactKind,
> extends ProjectIndexWorkerEventBase {
  readonly type: 'artifact:chunk'
  /** Artifact kind represented by the chunked payload. */
  readonly artifact: TKind
  /** Absolute project root for host-side identity validation. */
  readonly root: string
  /** Zero-based contiguous sequence number. */
  readonly sequence: number
  /** Chunk payload encoding. */
  readonly encoding: 'base64'
  /** Base64-encoded bytes from the artifact's JSON representation. */
  readonly payloadChunk: string
}

/** Reports an artifact-level worker failure. */
export interface ProjectIndexArtifactErrorEvent extends ProjectIndexWorkerEventBase {
  readonly type: 'artifact:error'
  /** Artifact kind that failed when known. */
  readonly artifact?: ProjectIndexArtifactKind
  /** JSON-safe error payload. */
  readonly error: {
    readonly message: string
    readonly code?: string
  }
}

/** All events emitted by the Project Index worker V2 stream. */
export type ProjectIndexWorkerEvent =
  | ProjectIndexPhaseStartEvent
  | ProjectIndexFactBatchEvent
  | ProjectIndexSourceProfileBatchEvent
  | ProjectIndexPhaseDoneEvent
  | ProjectIndexPhaseErrorEvent
  | ProjectIndexArtifactChunkEvent
  | ProjectIndexArtifactDoneEvent
  | ProjectIndexArtifactErrorEvent
