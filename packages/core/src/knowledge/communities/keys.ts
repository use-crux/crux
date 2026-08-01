/**
 * Key builders for connected knowledge community records.
 *
 * @module
 */

import { stableHash } from '../../indexing/hash'
import { indexedNamespacePrefix } from '../../indexed-knowledge/keys'

/** Input used to derive a community materialization scope key. */
export interface CommunityScopeKeyInput {
  /** View id for view-scoped communities; omit for whole-corpus scope. */
  readonly viewId?: string | null
  /** Stable fingerprint of the community strategy config. */
  readonly strategyFingerprint: string
}

/** Stable hash of the view-or-corpus scope and strategy fingerprint. */
export function communityScopeKey(input: CommunityScopeKeyInput): string {
  return stableHash([input.viewId ?? 'corpus', input.strategyFingerprint])
}

/** Key for the current community generation pointer for one scope. */
export function communityCurrentKey(indexerId: string, namespace: string, scopeKey: string): string {
  return `${communityPrefix(indexerId, namespace, scopeKey)}current`
}

/** Key for a generation-scoped community report. */
export function communityReportKey(
  indexerId: string,
  namespace: string,
  scopeKey: string,
  generationId: string,
  communityId: string,
): string {
  return `${communityGenerationPrefix(indexerId, namespace, scopeKey, generationId)}report:${communityId}`
}

/** Prefix for generation-scoped community reports. */
export function communityReportPrefix(
  indexerId: string,
  namespace: string,
  scopeKey: string,
  generationId: string,
): string {
  return `${communityGenerationPrefix(indexerId, namespace, scopeKey, generationId)}report:`
}

/** Key for a generation-scoped level index entry. */
export function communityLevelIndexKey(
  indexerId: string,
  namespace: string,
  scopeKey: string,
  generationId: string,
  level: number,
  communityId: string,
): string {
  return `${communityLevelIndexPrefix(indexerId, namespace, scopeKey, generationId, level)}${communityId}`
}

/** Prefix for generation-scoped level index entries at one level. */
export function communityLevelIndexPrefix(
  indexerId: string,
  namespace: string,
  scopeKey: string,
  generationId: string,
  level: number,
): string {
  return `${communityGenerationPrefix(indexerId, namespace, scopeKey, generationId)}index:${level}:`
}

/** Key for a dirty ledger entry keyed by source id. */
export function communityDirtyKey(indexerId: string, namespace: string, scopeKey: string, sourceId: string): string {
  return `${communityDirtyPrefix(indexerId, namespace, scopeKey)}${sourceId}`
}

/** Prefix for the dirty ledger. */
export function communityDirtyPrefix(indexerId: string, namespace: string, scopeKey: string): string {
  return `${communityPrefix(indexerId, namespace, scopeKey)}dirty:`
}

/** Key for the build lease for one community scope. */
export function communityLeaseKey(indexerId: string, namespace: string, scopeKey: string): string {
  return `${communityPrefix(indexerId, namespace, scopeKey)}lease`
}

/** Prefix for every community record in one materialization scope. */
export function communityPrefix(indexerId: string, namespace: string, scopeKey: string): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}communities:${scopeKey}:`
}

/** Prefix for every generation-scoped community record. */
export function communityGenerationPrefix(
  indexerId: string,
  namespace: string,
  scopeKey: string,
  generationId: string,
): string {
  return `${communityPrefix(indexerId, namespace, scopeKey)}gen:${generationId}:`
}
