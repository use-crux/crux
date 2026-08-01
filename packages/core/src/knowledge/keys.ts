/**
 * Key builders for connected knowledge records.
 *
 * This module extends the indexed namespace prefix from
 * {@link indexedNamespacePrefix} with connected knowledge record families.
 *
 * @module
 */

import { indexedNamespacePrefix } from '../indexed-knowledge/keys'
import { encodeKnowledgeRef, type KnowledgeRef } from './refs'

/** Key for the current connected knowledge generation pointer. */
export function knowledgeCurrentKey(indexerId: string, namespace: string): string {
  return `${knowledgePrefix(indexerId, namespace)}current`
}

/** Key for a generation-scoped connected knowledge edge record. */
export function knowledgeEdgeKey(indexerId: string, namespace: string, generationId: string, edgeId: string): string {
  return `${knowledgeGenerationPrefix(indexerId, namespace, generationId)}edge:${edgeId}`
}

/** Prefix for outbound adjacency pointer records for a {@link KnowledgeRef}. */
export function knowledgeAdjacencyOutPrefix(
  indexerId: string,
  namespace: string,
  generationId: string,
  from: KnowledgeRef,
): string {
  return `${knowledgeGenerationPrefix(indexerId, namespace, generationId)}adj:out:${encodeKnowledgeRef(from)}:`
}

/** Key for an outbound adjacency pointer record for a {@link KnowledgeRef}. */
export function knowledgeAdjacencyOutKey(
  indexerId: string,
  namespace: string,
  generationId: string,
  from: KnowledgeRef,
  type: string,
  edgeId: string,
): string {
  return `${knowledgeAdjacencyOutPrefix(indexerId, namespace, generationId, from)}${type}:${edgeId}`
}

/** Prefix for inbound adjacency pointer records for a {@link KnowledgeRef}. */
export function knowledgeAdjacencyInPrefix(
  indexerId: string,
  namespace: string,
  generationId: string,
  to: KnowledgeRef,
): string {
  return `${knowledgeGenerationPrefix(indexerId, namespace, generationId)}adj:in:${encodeKnowledgeRef(to)}:`
}

/** Key for an inbound adjacency pointer record for a {@link KnowledgeRef}. */
export function knowledgeAdjacencyInKey(
  indexerId: string,
  namespace: string,
  generationId: string,
  to: KnowledgeRef,
  type: string,
  edgeId: string,
): string {
  return `${knowledgeAdjacencyInPrefix(indexerId, namespace, generationId, to)}${type}:${edgeId}`
}

/** Key for a generation-scoped connected knowledge entity record. */
export function knowledgeEntityKey(indexerId: string, namespace: string, generationId: string, entityId: string): string {
  return `${knowledgeGenerationPrefix(indexerId, namespace, generationId)}entity:${entityId}`
}

/** Key for a generation-scoped connected knowledge entity alias record. */
export function knowledgeAliasKey(
  indexerId: string,
  namespace: string,
  generationId: string,
  alias: string,
  entityId: string,
): string {
  return `${knowledgeGenerationPrefix(indexerId, namespace, generationId)}alias:${alias}:${entityId}`
}

/** Key for a cached connected knowledge claim record emitted from a source. */
export function knowledgeClaimsKey(
  indexerId: string,
  namespace: string,
  stageId: string,
  sourceId: string,
  claimHash: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}claims:${stageId}:source:${sourceId}:${claimHash}`
}

/** Key for a generation-scoped assertion item record. */
export function knowledgeAssertionsItemKey(
  indexerId: string,
  namespace: string,
  stageId: string,
  generationId: string,
  assertionId: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}assertions:${stageId}:gen:${generationId}:item:${assertionId}`
}

/** Prefix for generation-scoped assertion item records. */
export function knowledgeAssertionsItemPrefix(
  indexerId: string,
  namespace: string,
  stageId: string,
  generationId: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}assertions:${stageId}:gen:${generationId}:item:`
}

/** Key for a generation-scoped assertion relation record. */
export function knowledgeAssertionsRelationKey(
  indexerId: string,
  namespace: string,
  stageId: string,
  generationId: string,
  relationId: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}assertions:${stageId}:gen:${generationId}:relation:${relationId}`
}

/** Prefix for generation-scoped assertion relation records. */
export function knowledgeAssertionsRelationPrefix(
  indexerId: string,
  namespace: string,
  stageId: string,
  generationId: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}assertions:${stageId}:gen:${generationId}:relation:`
}

/** Key for a view membership index entry. */
export function knowledgeViewIndexKey(
  indexerId: string,
  namespace: string,
  viewId: string,
  field: string,
  value: string,
  sourceId: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}view:${viewId}:index:${field}:${value}:${sourceId}`
}

/** Prefix for every membership index entry for one view. */
export function knowledgeViewIndexPrefix(indexerId: string, namespace: string, viewId: string): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}view:${viewId}:index:`
}

/** Key for a view backfill marker record. */
export function knowledgeViewBackfillKey(indexerId: string, namespace: string, viewId: string): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}view:${viewId}:backfill`
}

/** Key for a view revision record. */
export function knowledgeViewRevisionKey(
  indexerId: string,
  namespace: string,
  viewId: string,
  revisionHash: string,
): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}view:${viewId}:revision:${revisionHash}`
}

/** Prefix for every connected knowledge record in a namespace. Internal. */
export function knowledgePrefix(indexerId: string, namespace: string): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}knowledge:`
}

/** Prefix for every generation-scoped connected knowledge record. Internal. */
export function knowledgeGenerationPrefix(indexerId: string, namespace: string, generationId: string): string {
  return `${knowledgePrefix(indexerId, namespace)}gen:${generationId}:`
}
