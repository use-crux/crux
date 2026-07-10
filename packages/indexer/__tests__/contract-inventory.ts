/**
 * Test-facing inventory adapter for the Static Index runtime contract manifest.
 *
 * The canonical path inventory lives in `packages/indexer/src/contracts`.
 * Architecture tests keep using this compatibility shape while Phase 2 moves
 * drift checks to the contract spine itself.
 *
 * @module
 */

import {
  staticIndexRuntimeContractManifest,
  staticIndexRuntimeContractManifestGroups,
  type StaticIndexRuntimeContractManifestGroup,
  type StaticIndexRuntimeContractManifestGroupId,
  type StaticIndexRuntimeContractMirrorStatus as ManifestMirrorStatus,
  type StaticIndexRuntimeContractRuntime,
} from '../src/contracts/contract-manifest'

/** Contract groups that have to stay visible through the Static Index runtime split. */
export const staticIndexRuntimeContractIds = staticIndexRuntimeContractManifestGroups

/** Stable identifier for one current contract group. */
export type StaticIndexRuntimeContractId = StaticIndexRuntimeContractManifestGroupId

/** Language/runtime that owns or mirrors a contract file today. */
export type StaticIndexRuntimeContractOwner = StaticIndexRuntimeContractRuntime

/** Current file role inside a contract group. */
export type StaticIndexRuntimeContractFileKind =
  | 'canonical-types'
  | 'identity'
  | 'schema'
  | 'parser'
  | 'host-mirror'
  | 'native-mirror'
  | 'streaming'
  | 'test'

/** One source file that participates in a current cross-language contract. */
export interface StaticIndexRuntimeContractFile<
  TOwner extends StaticIndexRuntimeContractOwner = StaticIndexRuntimeContractOwner,
> {
  /** Runtime or language owner for this file. */
  readonly owner: TOwner
  /** Repository-relative path. */
  readonly path: string
  /** Short reason this file belongs in the contract inventory. */
  readonly role: string
  /** Machine-readable role used by the inventory test and docs. */
  readonly kind: StaticIndexRuntimeContractFileKind
}

/** Owner-bucketed file list for one contract group. */
export type StaticIndexRuntimeContractFilesByOwner = {
  readonly [TOwner in StaticIndexRuntimeContractOwner]: readonly StaticIndexRuntimeContractFile<TOwner>[]
}

/** Whether a current contract already has all intended language mirrors. */
export type StaticIndexRuntimeContractMirrorStatus = ManifestMirrorStatus

/** Public inventory row with owner buckets and a flattened file list. */
export interface StaticIndexRuntimeContractEntry<
  TId extends StaticIndexRuntimeContractId = StaticIndexRuntimeContractId,
> {
  readonly id: TId
  readonly label: string
  readonly boundary: string
  readonly canonicalOwner: 'typescript'
  readonly mirrorStatus: StaticIndexRuntimeContractMirrorStatus
  readonly filesByOwner: StaticIndexRuntimeContractFilesByOwner
  readonly fixtureGap: string
  /** Flattened files in TypeScript, Go, Rust order. */
  readonly files: readonly StaticIndexRuntimeContractFile[]
}

/** Returns current contract groups in migration order. */
export function staticIndexRuntimeContractInventory(): readonly StaticIndexRuntimeContractEntry[] {
  return staticIndexRuntimeContractManifest.groups.map(groupToEntry)
}

function groupToEntry<TId extends StaticIndexRuntimeContractId>(
  group: StaticIndexRuntimeContractManifestGroup<TId>,
): StaticIndexRuntimeContractEntry<TId> {
  const filesByOwner = {
    typescript: pathsToFiles('typescript', [...group.canonical, ...group.fixtures], group),
    go: pathsToFiles('go', group.mirrors.go, group),
    rust: pathsToFiles('rust', group.mirrors.rust, group),
  } satisfies StaticIndexRuntimeContractFilesByOwner
  return {
    id: group.id,
    label: group.label,
    boundary: group.description,
    canonicalOwner: 'typescript',
    mirrorStatus: group.mirrorStatus,
    filesByOwner,
    fixtureGap: group.fixtureCoverage,
    files: [...filesByOwner.typescript, ...filesByOwner.go, ...filesByOwner.rust],
  }
}

function pathsToFiles<TOwner extends StaticIndexRuntimeContractOwner>(
  owner: TOwner,
  paths: readonly string[],
  group: StaticIndexRuntimeContractManifestGroup,
): readonly StaticIndexRuntimeContractFile<TOwner>[] {
  return paths.map((path) => ({
    owner,
    path,
    role: `${group.label} ${fileKind(owner, path)} path`,
    kind: fileKind(owner, path),
  }))
}

function fileKind(owner: StaticIndexRuntimeContractOwner, path: string): StaticIndexRuntimeContractFileKind {
  if (path.includes('/fixtures/') && path.includes('identity')) return 'identity'
  if (path.endsWith('_test.go') || path.includes('_tests.rs') || path.includes('/fixtures/')) return 'test'
  if (path.includes('/schema')) return 'schema'
  if (path.includes('/worker-protocol/') || path.includes('/protocol/')) return 'parser'
  if (path.includes('/stream') || path.includes('/events')) return 'streaming'
  if (owner === 'go') return 'host-mirror'
  if (owner === 'rust') return 'native-mirror'
  return 'canonical-types'
}
