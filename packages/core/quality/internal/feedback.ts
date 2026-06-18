/**
 * Feedback store — record/annotate/list user feedback against runs and
 * experiments, plus portable-suite export for the "failures become datasets"
 * loop. Persists JSONL under `<quality dir>/feedback/` (`inbox.jsonl`,
 * `annotations.jsonl`, `memory-proposals.jsonl`) — the same on-disk format the
 * devtools server reads.
 *
 * The feedback pillar is deferred post-launch (capability register §16.6:
 * Later, not lost). This module keeps the machinery alive WITHOUT a public
 * `@crux/core/quality` export; the devtools backend and future feedback APIs
 * consume it through internal plumbing only.
 *
 * @internal Not exported from `@crux/core/quality` — kept for the deferred
 * feedback pillar and the devtools data feed.
 * @module
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { observe } from '../../observability'
import { applyRootRedaction } from './redact'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonRecord = { readonly [key: string]: JsonValue }

export type FeedbackStatus = 'new' | 'reviewed' | 'dismissed'

export interface FeedbackInput {
  readonly traceId?: string
  readonly experimentId?: string
  readonly caseId?: string
  readonly rating?: -1 | 0 | 1
  readonly comment?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface FeedbackRecord {
  readonly _tag: 'QualityFeedback'
  readonly id: string
  readonly qualityId: string
  readonly createdAt: string
  readonly status: FeedbackStatus
  readonly traceId?: string
  readonly experimentId?: string
  readonly caseId?: string
  readonly rating?: -1 | 0 | 1
  readonly comment?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface FeedbackAnnotationInput {
  readonly feedbackId: string
  readonly status?: FeedbackStatus
  readonly note?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface FeedbackAnnotationRecord {
  readonly _tag: 'QualityFeedbackAnnotation'
  readonly id: string
  readonly qualityId: string
  readonly feedbackId: string
  readonly createdAt: string
  readonly status?: FeedbackStatus
  readonly note?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface FeedbackMemoryProposalInput {
  readonly feedbackId: string
  readonly memoryId?: string
  readonly memoryKind?: string
  readonly proposal: JsonRecord
  readonly reason?: string
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface FeedbackMemoryProposalRecord {
  readonly _tag: 'QualityFeedbackMemoryProposal'
  readonly id: string
  readonly qualityId: string
  readonly feedbackId: string
  readonly createdAt: string
  readonly status: 'proposed'
  readonly memoryId?: string
  readonly memoryKind?: string
  readonly proposal: JsonRecord
  readonly reason?: string
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

/** Portable case-array JSON produced by feedback suite export. */
export interface PortableSuiteJson {
  readonly id: string
  readonly description?: string
  readonly cases: readonly {
    readonly id: string
    readonly name?: string
    readonly input: JsonRecord
    readonly expected?: JsonRecord
    readonly tags?: readonly string[]
    readonly metadata?: JsonRecord
  }[]
}

export interface FeedbackSuiteOptions {
  readonly id: string
  readonly description?: string
  readonly feedbackIds: readonly string[]
  readonly inputs?: Record<string, JsonRecord>
  readonly tag?: string
  readonly includeFeedbackMetadata?: boolean
}

export interface FeedbackWriteSuiteOptions extends FeedbackSuiteOptions {
  readonly path: string
}

export interface FeedbackStore {
  record(input: FeedbackInput): Promise<FeedbackRecord>
  list(): Promise<readonly FeedbackRecord[]>
  annotate(input: FeedbackAnnotationInput): Promise<FeedbackAnnotationRecord>
  listAnnotations(feedbackId?: string): Promise<readonly FeedbackAnnotationRecord[]>
  proposeMemory(input: FeedbackMemoryProposalInput): Promise<FeedbackMemoryProposalRecord>
  listMemoryProposals(feedbackId?: string): Promise<readonly FeedbackMemoryProposalRecord[]>
  exportSuite(options: FeedbackSuiteOptions): Promise<PortableSuiteJson>
  writeSuite(options: FeedbackWriteSuiteOptions): Promise<PortableSuiteJson>
}

export interface FeedbackStoreOptions {
  /** Workbench id stamped onto every record. */
  readonly qualityId: string
  /** Quality persistence root (the directory containing `feedback/`). */
  readonly dir: string
  /** Dot-path redactions applied to `expected`/`metadata`/`proposal` payloads. */
  readonly redact?: readonly string[]
}

/**
 * Open a file-backed feedback store rooted at `<dir>/feedback/`.
 *
 * Record/annotation/proposal writes are append-only JSONL; reads tolerate a
 * missing directory (empty store). Redaction is applied at write time.
 */
export function createFeedbackStore(options: FeedbackStoreOptions): FeedbackStore {
  const { qualityId, dir } = options
  const redactions = options.redact ?? []

  return Object.freeze({
    record: async (input: FeedbackInput) => {
      const span = observe.openSpan({
        name: 'feedback.record',
        family: 'feedback',
        primitive: 'feedback.record',
        attributes: feedbackInputAttributes(qualityId, input),
      })
      try {
        const record = await span.withContext(async () => {
          const created = createFeedbackRecord(qualityId, input, redactions)
          await appendFeedbackRecord(dir, created)
          emitFeedbackArtifact(span.spanId, created)
          return created
        })
        span.end({
          qualityId,
          feedbackId: record.id,
          status: record.status,
          traceId: record.traceId,
          experimentId: record.experimentId,
          caseId: record.caseId,
        })
        return record
      } catch (error) {
        span.error(error, feedbackInputAttributes(qualityId, input))
        throw error
      }
    },
    list: async () => {
      const records = await readFeedbackRecords(dir)
      records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      return Object.freeze(records)
    },
    annotate: async (input: FeedbackAnnotationInput) => {
      const record = await createFeedbackAnnotationRecord(qualityId, dir, input, redactions)
      await appendFeedbackAnnotationRecord(dir, record)
      return record
    },
    listAnnotations: async (feedbackId?: string) => {
      const records = await readFeedbackAnnotationRecords(dir)
      const filtered = feedbackId ? records.filter((record) => record.feedbackId === feedbackId) : records
      filtered.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      return Object.freeze(filtered)
    },
    proposeMemory: async (input: FeedbackMemoryProposalInput) => {
      const record = await createFeedbackMemoryProposalRecord(qualityId, dir, input, redactions)
      await appendFeedbackMemoryProposalRecord(dir, record)
      return record
    },
    listMemoryProposals: async (feedbackId?: string) => {
      const records = await readFeedbackMemoryProposalRecords(dir)
      const filtered = feedbackId ? records.filter((record) => record.feedbackId === feedbackId) : records
      filtered.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      return Object.freeze(filtered)
    },
    exportSuite: async (suiteOptions: FeedbackSuiteOptions) => exportFeedbackSuite(dir, suiteOptions),
    writeSuite: async (suiteOptions: FeedbackWriteSuiteOptions) => {
      const portable = await exportFeedbackSuite(dir, suiteOptions)
      await writeFile(suiteOptions.path, `${JSON.stringify(portable, null, 2)}\n`)
      return portable
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// Record creation + JSONL persistence
// ─────────────────────────────────────────────────────────────────

function createFeedbackRecord(
  qualityId: string,
  input: FeedbackInput,
  redactions: readonly string[],
): FeedbackRecord {
  const createdAt = new Date().toISOString()
  const metadata = input.metadata ? applyRootRedaction(input.metadata, 'metadata', redactions) : undefined
  return Object.freeze({
    _tag: 'QualityFeedback' as const,
    id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualityId,
    createdAt,
    status: 'new' as const,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.expected ? { expected: applyRootRedaction(input.expected, 'expected', redactions) } : {}),
    ...(input.tags ? { tags: Object.freeze([...input.tags]) } : {}),
    ...(metadata ? { metadata } : {}),
  })
}

async function appendFeedbackRecord(dir: string, record: FeedbackRecord): Promise<void> {
  const feedbackDir = join(dir, 'feedback')
  await mkdir(feedbackDir, { recursive: true })
  await appendFile(join(feedbackDir, 'inbox.jsonl'), `${JSON.stringify(record)}\n`)
}

async function readFeedbackRecords(dir: string): Promise<FeedbackRecord[]> {
  return readJsonlRecords(join(dir, 'feedback', 'inbox.jsonl'), isFeedbackRecord)
}

async function createFeedbackAnnotationRecord(
  qualityId: string,
  dir: string,
  input: FeedbackAnnotationInput,
  redactions: readonly string[],
): Promise<FeedbackAnnotationRecord> {
  if (!input.feedbackId.trim()) throw new Error('feedback.annotate(): feedbackId must be non-empty.')
  const feedbackRecords = await readFeedbackRecords(dir)
  if (!feedbackRecords.some((record) => record.id === input.feedbackId)) {
    throw new Error(`feedback.annotate(): feedback "${input.feedbackId}" was not found.`)
  }
  const createdAt = new Date().toISOString()
  return Object.freeze({
    _tag: 'QualityFeedbackAnnotation' as const,
    id: `feedback-annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualityId,
    feedbackId: input.feedbackId,
    createdAt,
    ...(input.status ? { status: input.status } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.expected ? { expected: applyRootRedaction(input.expected, 'expected', redactions) } : {}),
    ...(input.tags ? { tags: Object.freeze([...input.tags]) } : {}),
    ...(input.metadata ? { metadata: applyRootRedaction(input.metadata, 'metadata', redactions) } : {}),
  })
}

async function appendFeedbackAnnotationRecord(dir: string, record: FeedbackAnnotationRecord): Promise<void> {
  const feedbackDir = join(dir, 'feedback')
  await mkdir(feedbackDir, { recursive: true })
  await appendFile(join(feedbackDir, 'annotations.jsonl'), `${JSON.stringify(record)}\n`)
}

async function readFeedbackAnnotationRecords(dir: string): Promise<FeedbackAnnotationRecord[]> {
  return readJsonlRecords(join(dir, 'feedback', 'annotations.jsonl'), isFeedbackAnnotationRecord)
}

async function createFeedbackMemoryProposalRecord(
  qualityId: string,
  dir: string,
  input: FeedbackMemoryProposalInput,
  redactions: readonly string[],
): Promise<FeedbackMemoryProposalRecord> {
  if (!input.feedbackId.trim()) throw new Error('feedback.proposeMemory(): feedbackId must be non-empty.')
  const feedbackRecords = await readFeedbackRecords(dir)
  if (!feedbackRecords.some((record) => record.id === input.feedbackId)) {
    throw new Error(`feedback.proposeMemory(): feedback "${input.feedbackId}" was not found.`)
  }
  const createdAt = new Date().toISOString()
  return Object.freeze({
    _tag: 'QualityFeedbackMemoryProposal' as const,
    id: `feedback-memory-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualityId,
    feedbackId: input.feedbackId,
    createdAt,
    status: 'proposed' as const,
    ...(input.memoryId ? { memoryId: input.memoryId } : {}),
    ...(input.memoryKind ? { memoryKind: input.memoryKind } : {}),
    proposal: applyRootRedaction(input.proposal, 'proposal', redactions),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.tags ? { tags: Object.freeze([...input.tags]) } : {}),
    ...(input.metadata ? { metadata: applyRootRedaction(input.metadata, 'metadata', redactions) } : {}),
  })
}

async function appendFeedbackMemoryProposalRecord(dir: string, record: FeedbackMemoryProposalRecord): Promise<void> {
  const feedbackDir = join(dir, 'feedback')
  await mkdir(feedbackDir, { recursive: true })
  await appendFile(join(feedbackDir, 'memory-proposals.jsonl'), `${JSON.stringify(record)}\n`)
}

async function readFeedbackMemoryProposalRecords(dir: string): Promise<FeedbackMemoryProposalRecord[]> {
  return readJsonlRecords(join(dir, 'feedback', 'memory-proposals.jsonl'), isFeedbackMemoryProposalRecord)
}

async function readJsonlRecords<T>(path: string, guard: (value: unknown) => value is T): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
  const records: T[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parsed = JSON.parse(line) as unknown
    if (guard(parsed)) records.push(parsed)
  }
  return records
}

// ─────────────────────────────────────────────────────────────────
// Suite export
// ─────────────────────────────────────────────────────────────────

async function exportFeedbackSuite(dir: string, options: FeedbackSuiteOptions): Promise<PortableSuiteJson> {
  if (!options.id.trim()) throw new Error('feedback.exportSuite(): suite id must be non-empty.')
  if (options.feedbackIds.length === 0) {
    throw new Error('feedback.exportSuite(): feedbackIds must be non-empty.')
  }

  const feedbackRecords = await readFeedbackRecords(dir)
  const byId = new Map(feedbackRecords.map((record) => [record.id, record]))
  const cases: Array<PortableSuiteJson['cases'][number]> = []

  for (const feedbackId of options.feedbackIds) {
    const feedback = byId.get(feedbackId)
    if (!feedback) throw new Error(`feedback.exportSuite(): feedback "${feedbackId}" was not found.`)
    const input = options.inputs?.[feedback.id] ?? null
    if (!input) {
      throw new Error(
        `feedback.exportSuite(): feedback "${feedback.id}" has no input. Provide inputs["${feedback.id}"]; linked trace input is resolved by the devtools backend from canonical observability records.`,
      )
    }
    const tags = mergedFeedbackTags(feedback, options.tag)

    cases.push(
      Object.freeze({
        id: feedback.caseId ?? feedback.id,
        input,
        ...(feedback.expected ? { expected: feedback.expected } : {}),
        ...(tags.length > 0 ? { tags: Object.freeze(tags) } : {}),
        ...(options.includeFeedbackMetadata ? { metadata: feedbackExportMetadata(feedback) } : {}),
      }),
    )
  }

  return Object.freeze({
    id: options.id,
    ...(options.description ? { description: options.description } : {}),
    cases: Object.freeze(cases),
  })
}

function mergedFeedbackTags(feedback: FeedbackRecord, tag: string | undefined): readonly string[] {
  return [...new Set([...(feedback.tags ?? []), ...(tag ? [tag] : [])])]
}

function feedbackExportMetadata(feedback: FeedbackRecord): JsonRecord {
  return {
    qualityFeedbackId: feedback.id,
    ...(feedback.traceId ? { traceId: feedback.traceId } : {}),
    ...(feedback.experimentId ? { experimentId: feedback.experimentId } : {}),
    ...(feedback.rating !== undefined ? { rating: feedback.rating } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────
// Observability emission
// ─────────────────────────────────────────────────────────────────

function feedbackInputAttributes(qualityId: string, input: FeedbackInput): JsonRecord {
  return {
    qualityId,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    hasComment: input.comment !== undefined,
    hasExpected: input.expected !== undefined,
    tagCount: input.tags?.length ?? 0,
    metadataKeys: input.metadata ? Object.keys(input.metadata).sort() : [],
  }
}

function emitFeedbackArtifact(spanId: ReturnType<typeof observe.openSpan>['spanId'], record: FeedbackRecord): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      primitive: 'feedback.record',
      feedbackId: record.id,
      qualityId: record.qualityId,
      status: record.status,
      traceId: record.traceId,
      experimentId: record.experimentId,
      caseId: record.caseId,
      rating: record.rating,
      commentPreview: record.comment ? truncateText(record.comment, 500) : undefined,
      expected: record.expected,
      tags: record.tags,
      metadata: record.metadata,
    },
    attributes: {
      primitive: 'feedback.record',
      qualityId: record.qualityId,
      feedbackId: record.id,
      status: record.status,
      traceId: record.traceId,
      experimentId: record.experimentId,
      caseId: record.caseId,
      rating: record.rating,
      hasComment: record.comment !== undefined,
      hasExpected: record.expected !== undefined,
      tagCount: record.tags?.length ?? 0,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'feedback.record', feedbackId: record.id },
  })
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

// ─────────────────────────────────────────────────────────────────
// Guards + redaction
// ─────────────────────────────────────────────────────────────────

function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  return Boolean(value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityFeedback')
}

function isFeedbackAnnotationRecord(value: unknown): value is FeedbackAnnotationRecord {
  return Boolean(
    value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityFeedbackAnnotation',
  )
}

function isFeedbackMemoryProposalRecord(value: unknown): value is FeedbackMemoryProposalRecord {
  return Boolean(
    value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityFeedbackMemoryProposal',
  )
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code)
}
