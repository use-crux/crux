/**
 * Shared Static Index runtime fixture file loader.
 *
 * The fixture files in this directory are plain JSON on purpose: TypeScript
 * validates them against the canonical schemas, while Go and Rust consume the
 * same bytes through their mirrored protocol structs.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IndexRuleDescriptor } from '@use-crux/core/project-index'
import type {
  StaticIndexCompilerRequest,
  StaticIndexCompilerResponse,
  StaticIndexIdentityManifest,
} from '../static-index/schema'
import type { StaticSyntaxFileRecord } from '../static-syntax/schema'
import type { ProjectIndexWorkerEvent } from '../worker-events/schema'
import type { SemanticEvidenceBatch } from '../semantic/schema'
import type { IndexRelationPolicy } from '../../indexer/relations/types'
import type { IndexLintRuleId } from '../../indexer/lints/rules'

/** File-backed fixture names that are intended to be consumed across runtimes. */
export type StaticIndexRuntimeSharedFixtureName =
  | 'static-index-protocol'
  | 'static-index-protocol-cases'
  | 'static-index-identity'
  | 'worker-events'
  | 'worker-event-cases'
  | 'static-syntax-records'
  | 'static-syntax-record-cases'
  | 'semantic-evidence'
  | 'relation-specs'
  | 'rule-descriptors'
  | 'lint-rule-parity-coverage'
  | 'primitive-coverage-identities'

/** Typed payload for the shared Static Index protocol fixture. */
export interface StaticIndexProtocolSharedFixture {
  /** Requests for every supported Static Index compiler method. */
  readonly requests: readonly StaticIndexCompilerRequest[]
  /** Responses for every supported Static Index compiler method. */
  readonly responses: readonly StaticIndexCompilerResponse[]
}

/** Worker response error envelope fixture for non-streaming Static Index calls. */
export interface StaticIndexProtocolWorkerErrorFixture {
  /** Worker request id echoed by the failed response. */
  readonly id: number
  /** Failed response marker. */
  readonly ok: false
  /** JSON-safe error message returned by the compiler worker. */
  readonly error: string
}

/** Static Index stream error envelope fixture. */
export interface StaticIndexProtocolStreamErrorFixture {
  /** Worker request id echoed by the stream event. */
  readonly id: number
  /** Failed stream marker. */
  readonly ok: false
  /** Stream event discriminator. */
  readonly type: 'error'
  /** JSON-safe error message returned by the compiler worker. */
  readonly error: string
}

/** Static Index protocol edge cases shared by schema and host validation tests. */
export interface StaticIndexProtocolCasesSharedFixture {
  /** Non-streaming worker error envelope. */
  readonly workerError: StaticIndexProtocolWorkerErrorFixture
  /** Requests that must be rejected by the canonical TypeScript request parser. */
  readonly invalidRequests: readonly unknown[]
  /** Stream error event emitted by analyze. */
  readonly analyzeStreamError: StaticIndexProtocolStreamErrorFixture
  /** Stream error event emitted by finalize or compile. */
  readonly finalizeStreamError: StaticIndexProtocolStreamErrorFixture
  /** Analyze stream event with an unsupported event discriminator. */
  readonly invalidAnalyzeStreamEvent: unknown
  /** Finalize stream event missing the required Project Index event payload. */
  readonly invalidFinalizeStreamEvent: unknown
}

/** Shared Static Index compiler-owned identity manifest. */
export type StaticIndexIdentitySharedFixture = StaticIndexIdentityManifest

/** Shared Project Index worker event stream fixture. */
export interface WorkerEventsSharedFixture {
  /** Complete event stream for one AST patch transaction. */
  readonly events: readonly ProjectIndexWorkerEvent[]
}

/** Shared worker-event edge cases that should fail or route through non-patch collectors. */
export interface WorkerEventCasesSharedFixture {
  /** Successful artifact event consumed by artifact stream collectors. */
  readonly artifactDone: Extract<ProjectIndexWorkerEvent, { readonly type: 'artifact:done' }>
  /** Artifact error event consumed by artifact stream collectors. */
  readonly artifactError: Extract<ProjectIndexWorkerEvent, { readonly type: 'artifact:error' }>
  /** Phase error event consumed by patch stream collectors. */
  readonly phaseError: Extract<ProjectIndexWorkerEvent, { readonly type: 'phase:error' }>
  /** Invalid patch stream with a non-contiguous fact batch sequence. */
  readonly outOfOrderEvents: readonly ProjectIndexWorkerEvent[]
}

/** Shared static syntax record fixture. */
export interface StaticSyntaxRecordsSharedFixture {
  /** Parser evidence records emitted by the static syntax ABI. */
  readonly records: readonly StaticSyntaxFileRecord[]
}

/** Shared Static Syntax record edge cases for parser evidence mirrors. */
export interface StaticSyntaxRecordCasesSharedFixture {
  /** Records covering constructors, callback summaries, and diagnostics. */
  readonly records: readonly StaticSyntaxFileRecord[]
}

/** Shared TS-only semantic evidence fixture for backend-neutral projection. */
export interface SemanticEvidenceSharedFixture {
  /** Evidence batches covering every semantic evidence kind. */
  readonly batches: readonly SemanticEvidenceBatch[]
}

/** Shared built-in relation policy fixture. */
export interface RelationSpecsSharedFixture {
  /** Relation policies sampled from the TypeScript-owned built-in policy table. */
  readonly policies: readonly IndexRelationPolicy[]
}

/** Shared built-in rule descriptor fixture. */
export interface RuleDescriptorsSharedFixture {
  /** Rule descriptors sampled from the TypeScript-owned built-in lint catalog. */
  readonly descriptors: readonly IndexRuleDescriptor[]
}

/** Fixture class proving a lint rule's normalized TypeScript and native outputs. */
export type LintRuleParityEvidenceClass = 'positive' | 'negative'

/** Worker-backed parity evidence for one built-in lint rule. */
export interface LintRuleParityEvidenceFixture {
  /** Built-in rule id covered by the parity fixture. */
  readonly ruleId: IndexLintRuleId
  /** Test file that compares the positive finding payload across TypeScript and Rust. */
  readonly positiveFixture: string
  /** Test file that proves the matched graph shape does not produce a false positive. */
  readonly negativeFixture: string
}

/** Shared manifest for built-in lint parity coverage claims. */
export interface LintRuleParityCoverageSharedFixture {
  /** Evidence classes required before native lint coverage can be claimed. */
  readonly requiredEvidence: readonly LintRuleParityEvidenceClass[]
  /** Worker-backed parity fixtures for every built-in finding-producing rule. */
  readonly rules: readonly LintRuleParityEvidenceFixture[]
  /** Fixture proving config, profile, suppression, and diagnostic behavior through the native worker. */
  readonly policyFixture: string
}

/** Fixture classes required before a first-party primitive can be native-covered. */
export type PrimitiveCoverageFixtureClass =
  | 'definitions'
  | 'relations'
  | 'sourceRefs'
  | 'diagnostics'
  | 'dependencies'
  | 'lints'
  | 'sources'
  | 'sourceGraph'
  | 'runtimeMetadata'
  | 'degradedBehavior'

/** Native coverage identity and its fixture proof anchors. */
export interface PrimitiveCoverageIdentityFixture {
  /** Extension package that owns the extractor. */
  readonly extension: '@use-crux/indexer/crux-core'
  /** Extractor family name inside the extension. */
  readonly extractor: string
  /** Native primitive family name used in coverage diagnostics. */
  readonly family: string
  /** Whether the family is currently advertised as native-covered. */
  readonly nativeCovered: boolean
  /** Positive and negative native/fallback parity fixtures for this family. */
  readonly parityFixtures: {
    /** Fixture that proves supported syntax emits exact native facts. */
    readonly positive: string
    /** Fixture that proves unsupported/lookalike syntax does not emit partial native facts. */
    readonly negative: string
  }
  /** Existing fixture file that covers each required fixture class. */
  readonly fixtureClasses: Readonly<Record<PrimitiveCoverageFixtureClass, string>>
}

/** Shared native coverage manifest fixture. */
export interface PrimitiveCoverageIdentitiesSharedFixture {
  /** Fixture classes that must be present for every native-covered family. */
  readonly requiredFixtureClasses: readonly PrimitiveCoverageFixtureClass[]
  /** Native-covered first-party primitive identities. */
  readonly identities: readonly PrimitiveCoverageIdentityFixture[]
}

/** Payload type for each shared fixture file. */
export interface StaticIndexRuntimeSharedFixtureMap {
  readonly 'static-index-protocol': StaticIndexProtocolSharedFixture
  readonly 'static-index-protocol-cases': StaticIndexProtocolCasesSharedFixture
  readonly 'static-index-identity': StaticIndexIdentitySharedFixture
  readonly 'worker-events': WorkerEventsSharedFixture
  readonly 'worker-event-cases': WorkerEventCasesSharedFixture
  readonly 'static-syntax-records': StaticSyntaxRecordsSharedFixture
  readonly 'static-syntax-record-cases': StaticSyntaxRecordCasesSharedFixture
  readonly 'semantic-evidence': SemanticEvidenceSharedFixture
  readonly 'relation-specs': RelationSpecsSharedFixture
  readonly 'rule-descriptors': RuleDescriptorsSharedFixture
  readonly 'lint-rule-parity-coverage': LintRuleParityCoverageSharedFixture
  readonly 'primitive-coverage-identities': PrimitiveCoverageIdentitiesSharedFixture
}

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))

const fixtureFiles = {
  'static-index-protocol': 'static-index-protocol.json',
  'static-index-protocol-cases': 'static-index-protocol-cases.json',
  'static-index-identity': 'static-index-identity.json',
  'worker-events': 'worker-events.json',
  'worker-event-cases': 'worker-event-cases.json',
  'static-syntax-records': 'static-syntax-records.json',
  'static-syntax-record-cases': 'static-syntax-record-cases.json',
  'semantic-evidence': 'semantic-evidence.json',
  'relation-specs': 'relation-specs.json',
  'rule-descriptors': 'rule-descriptors.json',
  'lint-rule-parity-coverage': 'lint-rule-parity-coverage.json',
  'primitive-coverage-identities': 'primitive-coverage-identities.json',
} as const satisfies Record<StaticIndexRuntimeSharedFixtureName, string>

/**
 * Reads one JSON fixture from the TypeScript-owned contract spine.
 *
 * @param name - Stable fixture id, also used by Go and Rust tests.
 * @returns The parsed fixture payload with a name-specific TypeScript type.
 */
export function readStaticIndexRuntimeSharedFixture<const TName extends StaticIndexRuntimeSharedFixtureName>(
  name: TName,
): StaticIndexRuntimeSharedFixtureMap[TName] {
  const path = join(fixtureDirectory, fixtureFiles[name])
  return JSON.parse(readFileSync(path, 'utf8')) as StaticIndexRuntimeSharedFixtureMap[TName]
}
