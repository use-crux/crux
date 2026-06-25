/**
 * Shared native-runtime fixture file loader.
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
import type { IndexRuleDescriptor } from '@crux/core/project-index'
import type { StaticIndexCompilerRequest, StaticIndexCompilerResponse } from '../static-index/schema'
import type { StaticSyntaxFileRecord } from '../static-syntax/schema'
import type { ProjectIndexWorkerEvent } from '../worker-events/schema'
import type { IndexRelationPolicy } from '../../relations/types'

/** File-backed fixture names that are intended to be consumed across runtimes. */
export type NativeRuntimeSharedFixtureName =
  | 'native-static-protocol'
  | 'worker-events'
  | 'static-syntax-records'
  | 'relation-specs'
  | 'rule-descriptors'
  | 'primitive-coverage-identities'

/** Typed payload for the shared Static Index protocol fixture. */
export interface StaticIndexProtocolSharedFixture {
  /** Requests for every supported Static Index compiler method. */
  readonly requests: readonly StaticIndexCompilerRequest[]
  /** Responses for every supported Static Index compiler method. */
  readonly responses: readonly StaticIndexCompilerResponse[]
}

/** Shared Project Index worker event stream fixture. */
export interface WorkerEventsSharedFixture {
  /** Complete event stream for one AST patch transaction. */
  readonly events: readonly ProjectIndexWorkerEvent[]
}

/** Shared static syntax record fixture. */
export interface StaticSyntaxRecordsSharedFixture {
  /** Parser evidence records emitted by the static syntax ABI. */
  readonly records: readonly StaticSyntaxFileRecord[]
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

/** Fixture classes required before a first-party primitive can be native-covered. */
export type PrimitiveCoverageFixtureClass =
  | 'definitions'
  | 'relations'
  | 'sourceRefs'
  | 'diagnostics'
  | 'lints'
  | 'sources'
  | 'sourceGraph'
  | 'runtimeMetadata'
  | 'degradedBehavior'

/** Native coverage identity and its fixture proof anchors. */
export interface PrimitiveCoverageIdentityFixture {
  /** Extension package that owns the extractor. */
  readonly extension: '@crux/indexer/crux-core'
  /** Extractor family name inside the extension. */
  readonly extractor: string
  /** Native primitive family name used in coverage diagnostics. */
  readonly family: string
  /** Whether the family is currently advertised as native-covered. */
  readonly nativeCovered: boolean
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
export interface NativeRuntimeSharedFixtureMap {
  readonly 'native-static-protocol': StaticIndexProtocolSharedFixture
  readonly 'worker-events': WorkerEventsSharedFixture
  readonly 'static-syntax-records': StaticSyntaxRecordsSharedFixture
  readonly 'relation-specs': RelationSpecsSharedFixture
  readonly 'rule-descriptors': RuleDescriptorsSharedFixture
  readonly 'primitive-coverage-identities': PrimitiveCoverageIdentitiesSharedFixture
}

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))

const fixtureFiles = {
  'native-static-protocol': 'native-static-protocol.json',
  'worker-events': 'worker-events.json',
  'static-syntax-records': 'static-syntax-records.json',
  'relation-specs': 'relation-specs.json',
  'rule-descriptors': 'rule-descriptors.json',
  'primitive-coverage-identities': 'primitive-coverage-identities.json',
} as const satisfies Record<NativeRuntimeSharedFixtureName, string>

/**
 * Reads one JSON fixture from the TypeScript-owned contract spine.
 *
 * @param name - Stable fixture id, also used by Go and Rust tests.
 * @returns The parsed fixture payload with a name-specific TypeScript type.
 */
export function readNativeRuntimeSharedFixture<const TName extends NativeRuntimeSharedFixtureName>(
  name: TName,
): NativeRuntimeSharedFixtureMap[TName] {
  const path = join(fixtureDirectory, fixtureFiles[name])
  return JSON.parse(readFileSync(path, 'utf8')) as NativeRuntimeSharedFixtureMap[TName]
}
