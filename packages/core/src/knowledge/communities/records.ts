/**
 * Record codecs for connected knowledge community storage.
 *
 * @module
 */

import type { JsonObject } from '../../storage'
import { isKnowledgeRef, type KnowledgeRef } from '../refs'

const maxTitleLength = 120
const maxSummaryLength = 2_000
const maxStatementLength = 500

/** Report lineage used to compare community materialization freshness. */
export interface CommunityReportLineage {
  readonly viewRevision: string | null
  readonly graphGeneration: string
  readonly strategyFingerprint: string
  readonly memberHash: string
}

/** Summary counts for a community report. */
export interface CommunityReportCounts {
  readonly entities: number
  readonly chunks: number
  readonly assertions: number
}

/** Finding emitted in a persisted community report. */
export interface CommunityReportFinding {
  readonly id: string
  readonly statement: string
  readonly evidence: readonly KnowledgeRef[]
  readonly assertionRefs?: readonly { readonly assertionId: string }[]
}

/** Persisted community report record. */
export interface CommunityReport {
  readonly communityId: string
  readonly generationId: string
  readonly level: number
  readonly parentCommunityId?: string
  readonly title: string
  readonly summary: string
  readonly findings: readonly CommunityReportFinding[]
  readonly lineage: CommunityReportLineage
  readonly counts: CommunityReportCounts
}

/** Pointer to the active community generation for one scope. */
export interface CommunityGenerationPointerRecord {
  readonly generationId: string
  readonly scopeKey: string
  readonly namespace: string
  readonly viewRevision: string | null
  readonly graphGeneration: string
  readonly strategyFingerprint: string
  readonly updatedAt: number
}

/** Generation-scoped level index entry. */
export interface CommunityLevelIndexRecord {
  readonly generationId: string
  readonly communityId: string
  readonly level: number
  readonly parentCommunityId?: string
}

/** Dirty ledger entry keyed by source id. */
export interface CommunityDirtyLedgerRecord {
  readonly sourceId: string
  readonly reason: 'indexed' | 'removed'
  readonly touchedAt: number
}

/** Build lease record. */
export interface CommunityLeaseRecord {
  readonly owner: string
  readonly heartbeatAt: number
}

/** Create a validated persisted community report. */
export function createCommunityReportRecord(input: CommunityReport): CommunityReport {
  assertBounded('Community report title', input.title, maxTitleLength)
  assertBounded('Community report summary', input.summary, maxSummaryLength)
  for (const finding of input.findings) {
    assertBounded(`Community report finding "${finding.id}" statement`, finding.statement, maxStatementLength)
  }
  const record = cloneCommunityReport(input)
  if (!asCommunityReportRecord(record)) throw new Error('Invalid community report record.')
  return record
}

/** Create a generation pointer record. */
export function createCommunityGenerationPointerRecord(input: CommunityGenerationPointerRecord): CommunityGenerationPointerRecord {
  const record = { ...input }
  if (!asCommunityGenerationPointerRecord(record)) throw new Error('Invalid community generation pointer record.')
  return record
}

/** Create a level index entry. */
export function createCommunityLevelIndexRecord(input: CommunityLevelIndexRecord): CommunityLevelIndexRecord {
  const record = { ...input }
  if (!asCommunityLevelIndexRecord(record)) throw new Error('Invalid community level index record.')
  return record
}

/** Create a dirty ledger record. */
export function createCommunityDirtyLedgerRecord(input: CommunityDirtyLedgerRecord): CommunityDirtyLedgerRecord {
  const record = { ...input }
  if (!asCommunityDirtyLedgerRecord(record)) throw new Error('Invalid community dirty ledger record.')
  return record
}

/** Create a lease record. */
export function createCommunityLeaseRecord(input: CommunityLeaseRecord): CommunityLeaseRecord {
  const record = { ...input }
  if (!asCommunityLeaseRecord(record)) throw new Error('Invalid community lease record.')
  return record
}

/** Narrow an arbitrary stored value to a persisted community report. */
export function asCommunityReportRecord(value: unknown): CommunityReport | null {
  if (
    !isRecord(value) ||
    typeof value.communityId !== 'string' ||
    typeof value.generationId !== 'string' ||
    !isNonNegativeInteger(value.level) ||
    !isOptionalString(value.parentCommunityId) ||
    !isBoundedString(value.title, maxTitleLength) ||
    !isBoundedString(value.summary, maxSummaryLength) ||
    !Array.isArray(value.findings) ||
    !isCommunityReportLineage(value.lineage) ||
    !isCommunityReportCounts(value.counts)
  ) {
    return null
  }
  const findings = value.findings.map(asCommunityReportFinding)
  if (findings.some((finding) => finding === null)) return null
  return cloneCommunityReport({ ...value, findings: findings as readonly CommunityReportFinding[] } as CommunityReport)
}

/** Narrow an arbitrary stored value to a generation pointer record. */
export function asCommunityGenerationPointerRecord(value: unknown): CommunityGenerationPointerRecord | null {
  return isRecord(value) &&
    typeof value.generationId === 'string' &&
    typeof value.scopeKey === 'string' &&
    typeof value.namespace === 'string' &&
    (typeof value.viewRevision === 'string' || value.viewRevision === null) &&
    typeof value.graphGeneration === 'string' &&
    typeof value.strategyFingerprint === 'string' &&
    isFiniteNumber(value.updatedAt)
    ? value as unknown as CommunityGenerationPointerRecord
    : null
}

/** Narrow an arbitrary stored value to a level index record. */
export function asCommunityLevelIndexRecord(value: unknown): CommunityLevelIndexRecord | null {
  return isRecord(value) &&
    typeof value.generationId === 'string' &&
    typeof value.communityId === 'string' &&
    isNonNegativeInteger(value.level) &&
    isOptionalString(value.parentCommunityId)
    ? value as unknown as CommunityLevelIndexRecord
    : null
}

/** Narrow an arbitrary stored value to a dirty ledger record. */
export function asCommunityDirtyLedgerRecord(value: unknown): CommunityDirtyLedgerRecord | null {
  return isRecord(value) &&
    typeof value.sourceId === 'string' &&
    (value.reason === 'indexed' || value.reason === 'removed') &&
    isFiniteNumber(value.touchedAt)
    ? value as unknown as CommunityDirtyLedgerRecord
    : null
}

/** Narrow an arbitrary stored value to a lease record. */
export function asCommunityLeaseRecord(value: unknown): CommunityLeaseRecord | null {
  return isRecord(value) &&
    typeof value.owner === 'string' &&
    isFiniteNumber(value.heartbeatAt)
    ? value as unknown as CommunityLeaseRecord
    : null
}

function asCommunityReportFinding(value: unknown): CommunityReportFinding | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isBoundedString(value.statement, maxStatementLength) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    !value.evidence.every(isKnowledgeRef) ||
    !isOptionalAssertionRefs(value.assertionRefs)
  ) {
    return null
  }
  return {
    id: value.id,
    statement: value.statement,
    evidence: value.evidence,
    ...(value.assertionRefs !== undefined ? { assertionRefs: value.assertionRefs } : {}),
  }
}

function isCommunityReportLineage(value: unknown): value is CommunityReportLineage {
  return isRecord(value) &&
    (typeof value.viewRevision === 'string' || value.viewRevision === null) &&
    typeof value.graphGeneration === 'string' &&
    typeof value.strategyFingerprint === 'string' &&
    typeof value.memberHash === 'string'
}

function isCommunityReportCounts(value: unknown): value is CommunityReportCounts {
  return isRecord(value) &&
    isNonNegativeInteger(value.entities) &&
    isNonNegativeInteger(value.chunks) &&
    isNonNegativeInteger(value.assertions)
}

function isOptionalAssertionRefs(value: unknown): value is readonly { readonly assertionId: string }[] | undefined {
  return value === undefined || Array.isArray(value) && value.every((ref) => isRecord(ref) && typeof ref.assertionId === 'string')
}

function cloneCommunityReport(input: CommunityReport): CommunityReport {
  return {
    communityId: input.communityId,
    generationId: input.generationId,
    level: input.level,
    ...(input.parentCommunityId !== undefined ? { parentCommunityId: input.parentCommunityId } : {}),
    title: input.title,
    summary: input.summary,
    findings: input.findings.map((finding) => ({
      id: finding.id,
      statement: finding.statement,
      evidence: finding.evidence.map((ref) => ({ ...ref })) as readonly KnowledgeRef[],
      ...(finding.assertionRefs ? { assertionRefs: finding.assertionRefs.map((ref) => ({ ...ref })) } : {}),
    })),
    lineage: { ...input.lineage },
    counts: { ...input.counts },
  }
}

function assertBounded(label: string, value: string, maxLength: number): void {
  if (!isBoundedString(value, maxLength)) throw new Error(`${label} must be at most ${maxLength} characters.`)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
