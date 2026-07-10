/**
 * Canonical manifest for cross-language Project Index contracts.
 *
 * The manifest is intentionally data-shaped: TypeScript owns the contract
 * spine, while Go and Rust mirrors prove conformance through the listed
 * fixtures and version checks. The JSON payload is also consumed by the root
 * `check:indexer-contracts` script, so tests and CLI validation read the same
 * source of truth.
 *
 * @module
 */

import manifestData from './contract-manifest.json'

/** Contract groups in the order they are validated and documented. */
export const staticIndexRuntimeContractManifestGroups = [
  'worker-events',
  'static-syntax-records',
  'static-index',
  'semantic-evidence',
] as const

/** Stable identifier for a manifest contract group. */
export type StaticIndexRuntimeContractManifestGroupId = (typeof staticIndexRuntimeContractManifestGroups)[number]

/** Runtime that owns a canonical contract or mirrors it locally. */
export type StaticIndexRuntimeContractRuntime = 'typescript' | 'go' | 'rust'

/**
 * Explicit conformance mode for one contract group.
 *
 * `checked-mirror` means native structs remain hand-written but are fixture
 * and version checked against TypeScript-owned contracts. `generated` is
 * reserved for future schema/codegen output. `typescript-only` means no native
 * mirror is expected for the group.
 */
export type StaticIndexRuntimeContractMirrorStatus = 'generated' | 'checked-mirror' | 'typescript-only'

/** Protocol version keys tracked by the manifest. */
export type StaticIndexRuntimeContractProtocolVersionName = 'projectIndexWorkerEvents' | 'staticIndexCompiler'

/** Canonical protocol versions that every mirror must match. */
export type StaticIndexRuntimeContractProtocolVersions = {
  readonly [TName in StaticIndexRuntimeContractProtocolVersionName]: number
}

/** Data-driven check that extracts a protocol version from one mirror file. */
export interface StaticIndexRuntimeProtocolVersionCheck<
  TName extends StaticIndexRuntimeContractProtocolVersionName = StaticIndexRuntimeContractProtocolVersionName,
> {
  /** Protocol version key this check validates. */
  readonly version: TName
  /** Runtime whose mirror contains the version constant or emitted value. */
  readonly runtime: StaticIndexRuntimeContractRuntime
  /** Repository-relative source path to inspect. */
  readonly path: string
  /** Regular expression with one numeric capture group for the version. */
  readonly pattern: string
}

/** Go and Rust paths that mirror a TypeScript-owned contract group. */
export interface StaticIndexRuntimeContractMirrors {
  /** Go local-runtime mirror paths, when Go inspects the protocol directly. */
  readonly go: readonly string[]
  /** Rust native-compiler mirror paths, when Rust emits or accepts the protocol. */
  readonly rust: readonly string[]
}

/** One TypeScript-owned contract group and its checked native mirrors. */
export interface StaticIndexRuntimeContractManifestGroup<
  TId extends StaticIndexRuntimeContractManifestGroupId = StaticIndexRuntimeContractManifestGroupId,
> {
  /** Stable group id used by tests, fixtures, docs, and the check script. */
  readonly id: TId
  /** Human-readable contract group label. */
  readonly label: string
  /** Boundary this group owns in product language. */
  readonly description: string
  /** How non-TypeScript mirrors are kept aligned with the contract spine. */
  readonly mirrorStatus: StaticIndexRuntimeContractMirrorStatus
  /** TypeScript-owned contract and implementation paths. */
  readonly canonical: readonly string[]
  /** Shared fixture files that validate the contract group. */
  readonly fixtures: readonly string[]
  /** Runtime mirror paths that are validated against the contract group. */
  readonly mirrors: StaticIndexRuntimeContractMirrors
  /** Summary of the fixture coverage expected by cross-language tests. */
  readonly fixtureCoverage: string
  /** Intentional untyped JSON boundaries that remain after Phase 2. */
  readonly jsonBoundaries: readonly string[]
}

/** Complete machine-readable contract manifest. */
export interface StaticIndexRuntimeContractManifest {
  /** Manifest schema version for the checker itself. */
  readonly schemaVersion: 1
  /** Canonical protocol versions shared across runtimes. */
  readonly protocolVersions: StaticIndexRuntimeContractProtocolVersions
  /** Version extraction checks for TypeScript, Go, and Rust mirrors. */
  readonly protocolVersionChecks: readonly StaticIndexRuntimeProtocolVersionCheck[]
  /** Contract groups owned by `packages/indexer/src/contracts`. */
  readonly groups: readonly StaticIndexRuntimeContractManifestGroup[]
}

/** Type helper for selecting one group from a manifest by id. */
export type StaticIndexRuntimeContractGroupFromManifest<
  TManifest extends StaticIndexRuntimeContractManifest,
  TId extends StaticIndexRuntimeContractManifestGroupId,
> = Extract<TManifest['groups'][number], { readonly id: TId }>

/** Canonical cross-language Project Index contract manifest. */
export const staticIndexRuntimeContractManifest = manifestData as StaticIndexRuntimeContractManifest

/**
 * Return one manifest group by id.
 *
 * @param id - Contract group id to retrieve.
 * @returns The matching manifest group.
 */
export function getStaticIndexRuntimeContractManifestGroup<const TId extends StaticIndexRuntimeContractManifestGroupId>(
  id: TId,
): StaticIndexRuntimeContractManifestGroup<TId> {
  const group = staticIndexRuntimeContractManifest.groups.find((candidate) => candidate.id === id)
  if (!group) throw new Error(`Unknown Static Index runtime contract group: ${id}`)
  return group as StaticIndexRuntimeContractManifestGroup<TId>
}
