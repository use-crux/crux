import { z } from 'zod'
import { contextWithFullPromptInput } from '../prompt/context'
import type { AnyToolSet } from '../types'
import type { ExactFilter, FilterValue, JsonObject, RecordStore, Storage, VectorHit, VectorStore } from '../storage'
import { inMemoryStorage } from '../storage'
import type { DenseEmbedding } from '../embedding'
import { getHooks } from '../runtime/runtime'
import { observe } from '../observability'
import { contentText } from '../content'
import { isMessageContent } from '../content/guards'
import { registerInspectableResource } from '../runtime-bridge/resources'
import { redactSensitiveValue } from '../shared/redaction'
import {
  resolveMemoryNamespace,
  resolveMemoryNamespaceSync,
  type MemoryNamespace,
} from './namespace'
import { applyMemoryPolicy, type MemoryPolicyDecisionEvent } from './policy-safety'
import type {
  Memory,
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryCaptureConfig,
  MemoryCaptureMode,
  MemoryConfig,
  MemoryMessage,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRuntimeOptions,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
} from './contracts'
import {
  isMemoryEntryRenderStrategy,
  renderBudgetedMemoryBlocksWithDecision,
  renderMemoryEntries,
  type MemoryBudget,
  type MemoryEntryRenderStrategy,
  type MemoryRenderBudgetDecision,
} from './rendering'

export type {
  Memory,
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryBudget,
  MemoryCaptureConfig,
  MemoryCaptureMode,
  MemoryConfig,
  MemoryMessage,
  MemoryNamespace,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRuntimeOptions,
  MemoryEntryRenderStrategy,
  MemoryListRenderStrategy,
  MemoryRenderQuery,
  MemorySemanticRenderStrategy,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
} from './contracts'

export interface MemoryEntryApi {
  key: string
  content: string
  metadata: Record<string, unknown>
  confidence?: number
  score?: number
  createdAt: number
  updatedAt: number
}

interface ResolvedCaptureConfig {
  mode: MemoryCaptureMode
  waitUntil?: (promise: Promise<unknown>) => void
}

interface ResolvedMemoryStorage {
  storage: Storage
  records: RecordStore
  vectors?: VectorStore
  backend: 'configured' | 'inMemory'
}

type EmbedLike = ((text: string) => Promise<number[]>) | DenseEmbedding

function normalizeEmbed(embed: EmbedLike | undefined): ((text: string) => Promise<number[]>) | undefined {
  if (!embed) return undefined
  if (typeof embed === 'function') return embed
  return (text: string) => embed.embed(text)
}

function now() {
  return Date.now()
}

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function encodePart(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '~')
}

function decodePart(value: string): string {
  return decodeURIComponent(value.replace(/~/g, '%'))
}

function blockPrefix(memoryId: string, namespace: string, blockId: string): string {
  return `memory:${encodePart(memoryId)}:${encodePart(namespace)}:block:${encodePart(blockId)}:`
}

function proposalPrefix(memoryId: string, namespace: string): string {
  return `memory:${encodePart(memoryId)}:${encodePart(namespace)}:proposal:`
}

function valueToEntry(entry: { key: string; value: JsonObject }, score?: number): MemoryEntryApi {
  const metadata = isRecord(entry.value.metadata) ? entry.value.metadata : {}
  return {
    key: entry.key,
    content: storedContentText(entry.value.content),
    metadata,
    confidence: typeof entry.value.confidence === 'number' ? entry.value.confidence : undefined,
    score,
    createdAt: typeof entry.value.createdAt === 'number' ? entry.value.createdAt : 0,
    updatedAt: typeof entry.value.updatedAt === 'number' ? entry.value.updatedAt : 0,
  }
}

function storedContentText(content: unknown): string {
  if (content === undefined || content === null) return ''
  return isMessageContent(content) ? contentText(content) : String(content)
}

function memoryMessageLine(message: { readonly role?: unknown; readonly content?: unknown }): string {
  const role = String(message.role ?? '')
  const content = storedContentText(message.content)
  return `${role}: ${content}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return omitUndefinedObjectProperties(value) as JsonObject
}

/**
 * Storage records are strict JSON objects. Proposal and message builders often
 * carry optional fields as `undefined`, so omit those object properties before
 * the storage layer validates the payload.
 */
function omitUndefinedObjectProperties(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = omitUndefined(item)
    if (normalized !== undefined) output[key] = normalized
  }
  return output
}

function omitUndefined(value: unknown): unknown {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.map((item) => omitUndefined(item) ?? null)
  if (isPlainRecord(value)) return omitUndefinedObjectProperties(value)
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isFilterValue(value: unknown): value is FilterValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function toExactFilter(value: Record<string, unknown> | ExactFilter | undefined): ExactFilter | undefined {
  if (!value) return undefined
  const filter: Record<string, FilterValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isFilterValue(item)) filter[key] = item
  }
  return filter
}

function vectorMetadata(
  blockId: string,
  namespace: string,
  metadata: Record<string, unknown> | undefined,
): ExactFilter {
  return {
    ...(toExactFilter(metadata) ?? {}),
    blockId,
    namespace,
  }
}

function mergeVectorFilter(
  blockId: string,
  namespace: string,
  filter: Record<string, unknown> | ExactFilter | undefined,
): ExactFilter {
  return {
    ...(toExactFilter(filter) ?? {}),
    blockId,
    namespace,
  }
}

async function hydrateVectorHits(records: RecordStore, hits: readonly VectorHit[]): Promise<MemoryEntryApi[]> {
  const entries: MemoryEntryApi[] = []
  for (const hit of hits) {
    const value = await records.get(hit.key)
    if (value) entries.push(valueToEntry({ key: hit.key, value }, hit.score))
  }
  return entries
}

function resolveMemoryStorage(config: Pick<MemoryConfig, 'storage' | 'records' | 'vectors'>): ResolvedMemoryStorage {
  if (config.storage) {
    return {
      storage: config.storage,
      records: config.records ?? config.storage.records,
      vectors: config.vectors ?? config.storage.vectors,
      backend: 'configured',
    }
  }
  if (config.records) {
    return {
      storage: { records: config.records, vectors: config.vectors },
      records: config.records,
      vectors: config.vectors,
      backend: 'configured',
    }
  }
  const storage = inMemoryStorage()
  return {
    storage,
    records: storage.records,
    vectors: storage.vectors,
    backend: 'inMemory',
  }
}

function resolveRuntimeStorage(
  fallback: ResolvedMemoryStorage,
  options: Pick<Partial<MemoryRuntimeOptions>, 'storage' | 'records' | 'vectors'>,
): ResolvedMemoryStorage {
  if (options.storage) {
    return {
      storage: options.storage,
      records: options.records ?? options.storage.records,
      vectors: options.vectors ?? options.storage.vectors,
      backend: 'configured',
    }
  }
  if (options.records || options.vectors) {
    const records = options.records ?? fallback.records
    const vectors = options.vectors ?? fallback.vectors
    return {
      storage: { records, vectors },
      records,
      vectors,
      backend: 'configured',
    }
  }
  return fallback
}

function namespaceHash(namespace: string): string {
  let hash = 0
  for (let index = 0; index < namespace.length; index++) {
    hash = (hash * 31 + namespace.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

function omitSnapshot(extra: Record<string, unknown>): Record<string, unknown> {
  const { snapshot: _snapshot, recall: _recall, diff: _diff, ...attributes } = extra
  void _snapshot
  void _recall
  void _diff
  return redactSensitiveValue(attributes) as Record<string, unknown>
}

interface MemoryRecallArtifactInput {
  query?: string
  results: readonly MemoryEntryApi[]
}

interface MemoryBlockSummary {
  key?: string
  preview: string
  score?: number
}

interface MemoryDiffArtifactInput {
  before?: unknown
  after?: unknown
  added?: readonly MemoryBlockSummary[]
  removed?: readonly MemoryBlockSummary[]
  updated?: readonly MemoryBlockSummary[]
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  try {
    return JSON.parse(JSON.stringify(z.toJSONSchema(schema as z.ZodType))) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function memoryMetadata(
  ctx: MemoryRuntimeOptions,
  block: Pick<MemoryBlock, 'id' | 'kind'>,
  extra: Record<string, unknown>,
) {
  const metadata = isRecord(extra.metadata) ? extra.metadata : {}
  return {
    sourceDefinitionId: `memory:${ctx.memoryId ?? 'standalone'}`,
    blockDefinitionId: `memory.block:${ctx.memoryId ?? 'standalone'}:${block.id}`,
    ...(metadata.backend ? { backend: metadata.backend } : {}),
    ...(metadata.evictionPolicy ? { evictionPolicy: metadata.evictionPolicy } : {}),
    ...(metadata.retentionPolicy ? { retentionPolicy: metadata.retentionPolicy } : {}),
    ...(typeof metadata.lastGcAt === 'number' ? { lastGcAt: metadata.lastGcAt } : {}),
    ...(typeof metadata.lastGcEvicted === 'number' ? { lastGcEvicted: metadata.lastGcEvicted } : {}),
    ...(metadata.schema ? { schema: metadata.schema } : {}),
  }
}

function emitMemoryObservation(
  kind: 'read' | 'write',
  ctx: MemoryRuntimeOptions,
  block: Pick<MemoryBlock, 'id' | 'kind'>,
  operation: string,
  attributes: Record<string, unknown>,
): { spanId: string; runId: string } {
  const memoryId = ctx.memoryId ?? 'standalone'
  const primitive = kind === 'read' ? 'memory.read' : 'memory.write'
  const metadata = memoryMetadata(ctx, block, attributes)
  const span = observe.openSpan({
    name: `${block.id}.${operation}`,
    primitive,
    attributes: {
      memoryId,
      operation,
      memoryType: 'block',
      blockId: block.id,
      blockKind: block.kind,
      namespaceHash: namespaceHash(ctx.namespace),
      promptId: ctx.promptId,
      traceId: ctx.traceId,
      ...metadata,
      ...omitSnapshot(attributes),
    },
  })

  try {
    span.withContext(() => {
      const snapshot = attributes.snapshot
      if (snapshot !== undefined) {
        const artifactId = observe.artifact({
          kind: 'memory.snapshot',
          contentType: 'application/json',
          encoding: 'json',
          preview: memorySnapshotPreview(snapshot, {
            memoryType: 'block',
            blockKind: block.kind,
            operation,
            metadata,
            attributes,
          }),
          attributes: {
            memoryId,
            operation,
            memoryType: 'block',
            blockId: block.id,
            blockKind: block.kind,
            namespaceHash: namespaceHash(ctx.namespace),
          },
        })
        if (artifactId) {
          observe.edge({
            edgeType: primitive,
            from: kind === 'read' ? { kind: 'artifact', id: artifactId } : { kind: 'span', id: span.spanId },
            to: kind === 'read' ? { kind: 'span', id: span.spanId } : { kind: 'artifact', id: artifactId },
            attributes: { memoryId, blockId: block.id, blockKind: block.kind, operation },
          })
        }
      }
      const recall = memoryRecallInput(attributes.recall)
      if (recall) {
        const artifactId = observe.artifact({
          kind: 'memory.recall',
          contentType: 'application/json',
          encoding: 'json',
          preview: memoryRecallPreview(recall, {
            memoryType: 'block',
            blockKind: block.kind,
            operation,
          }),
          attributes: {
            memoryId,
            operation,
            memoryType: 'block',
            blockId: block.id,
            blockKind: block.kind,
            namespaceHash: namespaceHash(ctx.namespace),
          },
        })
        if (artifactId) {
          observe.edge({
            edgeType: 'memory.read',
            from: { kind: 'artifact', id: artifactId },
            to: { kind: 'span', id: span.spanId },
            attributes: { memoryId, blockId: block.id, blockKind: block.kind, operation },
          })
        }
      }
      const diff = memoryDiffInput(attributes.diff)
      if (diff) {
        const artifactId = observe.artifact({
          kind: 'memory.diff',
          contentType: 'application/json',
          encoding: 'json',
          preview: memoryDiffPreview(diff, {
            memoryType: 'block',
            blockKind: block.kind,
            operation,
          }),
          attributes: {
            memoryId,
            operation,
            memoryType: 'block',
            blockId: block.id,
            blockKind: block.kind,
            namespaceHash: namespaceHash(ctx.namespace),
          },
        })
        if (artifactId) {
          observe.edge({
            edgeType: 'memory.write',
            from: { kind: 'span', id: span.spanId },
            to: { kind: 'artifact', id: artifactId },
            attributes: { memoryId, blockId: block.id, blockKind: block.kind, operation },
          })
        }
      }
      observe.event({
        name: primitive,
        attributes: {
          memoryId,
          operation,
          blockId: block.id,
          blockKind: block.kind,
          ...metadata,
          ...omitSnapshot(attributes),
        },
      })
    })
    span.end({ attributes: omitSnapshot(attributes) })
  } catch (error) {
    span.error(error)
  }
  return { spanId: span.spanId, runId: span.runId }
}

function memoryRecallInput(value: unknown): MemoryRecallArtifactInput | undefined {
  if (!isRecord(value) || !Array.isArray(value.results)) return undefined
  const results = value.results.filter(isMemoryEntryApi)
  if (results.length === 0) return undefined
  return {
    query: typeof value.query === 'string' ? value.query : undefined,
    results,
  }
}

function isMemoryEntryApi(value: unknown): value is MemoryEntryApi {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  )
}

function memoryDiffInput(value: unknown): MemoryDiffArtifactInput | undefined {
  if (!isRecord(value)) return undefined
  return {
    before: 'before' in value ? value.before : undefined,
    after: 'after' in value ? value.after : undefined,
    added: memorySummaryList(value.added),
    removed: memorySummaryList(value.removed),
    updated: memorySummaryList(value.updated),
  }
}

function memorySummaryList(value: unknown): readonly MemoryBlockSummary[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter(isMemoryBlockSummary)
}

function isMemoryBlockSummary(value: unknown): value is MemoryBlockSummary {
  return (
    isRecord(value) &&
    typeof value.preview === 'string' &&
    (!('key' in value) || typeof value.key === 'string') &&
    (!('score' in value) || typeof value.score === 'number')
  )
}

function previewText(value: unknown): string {
  if (typeof value === 'string') return String(redactSensitiveValue(value)).slice(0, 240)
  try {
    return JSON.stringify(redactSensitiveValue(value))?.slice(0, 240) ?? String(value)
  } catch {
    return String(redactSensitiveValue(value)).slice(0, 240)
  }
}

function memoryRecallPreview(
  recall: MemoryRecallArtifactInput,
  args: { memoryType: string; blockKind: string; operation: string },
) {
  return {
    kind: 'memory.recall',
    memoryType: args.memoryType,
    blockKind: args.blockKind,
    operation: args.operation,
    ...(recall.query ? { query: recall.query } : {}),
    returned: recall.results.length,
    blocks: recall.results.map((entry) => ({
      blockKind: args.blockKind,
      key: entry.key,
      preview: previewText(entry.content),
      ...(typeof entry.score === 'number' ? { score: entry.score } : {}),
    })),
  }
}

function memoryDiffPreview(
  diff: MemoryDiffArtifactInput,
  args: { memoryType: string; blockKind: string; operation: string },
) {
  return {
    kind: 'memory.diff',
    memoryType: args.memoryType,
    blockKind: args.blockKind,
    operation: args.operation,
    ...('before' in diff ? { before: redactSensitiveValue(diff.before) } : {}),
    ...('after' in diff ? { after: redactSensitiveValue(diff.after) } : {}),
    ...(diff.added ? { added: diff.added.map((entry) => memorySummaryPreview(entry, args.blockKind)) } : {}),
    ...(diff.removed ? { removed: diff.removed.map((entry) => memorySummaryPreview(entry, args.blockKind)) } : {}),
    ...(diff.updated ? { updated: diff.updated.map((entry) => memorySummaryPreview(entry, args.blockKind)) } : {}),
  }
}

function memorySummaryPreview(entry: MemoryBlockSummary, blockKind: string): MemoryBlockSummary & { blockKind: string } {
  return {
    blockKind,
    ...entry,
    preview: previewText(entry.preview),
  }
}

function memorySnapshotPreview(
  snapshot: unknown,
  args: {
    memoryType: string
    blockKind: string
    operation: string
    metadata: Record<string, unknown>
    attributes: Record<string, unknown>
  },
): Record<string, unknown> {
  const body = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : { value: snapshot }
  return {
    kind: 'memory.snapshot',
    memoryType: args.memoryType,
    blockKind: args.blockKind,
    operation: args.operation,
    ...(redactSensitiveValue(body) as Record<string, unknown>),
    ...(typeof args.attributes.writeMode === 'string' ? { mode: args.attributes.writeMode } : {}),
    ...(typeof args.attributes.proposalStatus === 'string' ? { status: args.attributes.proposalStatus } : {}),
    ...args.metadata,
  }
}

function emitBlockWrite(
  ctx: MemoryRuntimeOptions,
  block: Pick<MemoryBlock, 'id' | 'kind'>,
  operation: string,
  extra: Record<string, unknown> = {},
) {
  emitMemoryObservation('write', ctx, block, operation, extra)
}

function emitBlockRead(
  ctx: MemoryRuntimeOptions,
  block: Pick<MemoryBlock, 'id' | 'kind'>,
  operation: string,
  resultCount: number,
  startedAt: number,
  extra: Record<string, unknown> = {},
) {
  const durationMs = now() - startedAt
  emitMemoryObservation('read', ctx, block, operation, {
    resultCount,
    durationMs,
    ...extra,
  })
}

function emitMemoryRenderObservation(
  ctx: MemoryRuntimeOptions,
  memoryId: string,
  decision: MemoryRenderBudgetDecision,
) {
  const attributes = {
    memoryId,
    operation: 'render',
    memoryType: 'memory',
    namespaceHash: namespaceHash(ctx.namespace),
    budgetMaxTokens: decision.maxTokens,
    budgetUsedTokens: decision.usedTokens,
    budgetCandidateBlocks: decision.candidateBlocks,
    budgetIncludedBlocks: decision.includedBlocks,
    budgetTrimmedBlocks: decision.trimmedBlocks,
    budgetDroppedBlocks: decision.droppedBlocks,
  }
  const span = observe.openSpan({
    name: `${memoryId}.render`,
    primitive: 'memory.read',
    attributes,
  })

  try {
    span.withContext(() => {
      const artifactId = observe.artifact({
        kind: 'memory.snapshot',
        contentType: 'application/json',
        encoding: 'json',
        preview: {
          kind: 'memory.snapshot',
          memoryType: 'memory',
          operation: 'render',
          budget: {
            maxTokens: decision.maxTokens,
            usedTokens: decision.usedTokens,
            candidateBlocks: decision.candidateBlocks,
            includedBlocks: decision.includedBlocks,
            trimmedBlocks: decision.trimmedBlocks,
            droppedBlocks: decision.droppedBlocks,
          },
        },
        attributes: {
          memoryId,
          operation: 'render',
          memoryType: 'memory',
          namespaceHash: namespaceHash(ctx.namespace),
        },
      })
      if (artifactId) {
        observe.edge({
          edgeType: 'memory.read',
          from: { kind: 'artifact', id: artifactId },
          to: { kind: 'span', id: span.spanId },
          attributes: { memoryId, operation: 'render' },
        })
      }
      observe.event({ name: 'memory.read', attributes })
    })
    span.end({ attributes })
  } catch (error) {
    span.error(error)
  }
}

function emitMemoryPolicyDecision(
  ctx: MemoryBlockContext,
  block: Pick<MemoryBlock, 'id' | 'kind'>,
  event: MemoryPolicyDecisionEvent,
): void {
  const { decision } = event
  emitBlockWrite(ctx, block, `policy.${event.hook}`, {
    safetyPolicyId: decision.policyId,
    safetyDecisionKind: decision.kind,
    safetyBoundary: decision.boundary,
    safetyMode: decision.mode,
    safetyDecisionAction: decision.action,
    ...(decision.reason ? { safetyReason: decision.reason } : {}),
    durationMs: decision.durationMs,
    snapshot: {
      safetyDecision: decision,
    },
  })
}

function defaultPriority(kind: MemoryBlockKind): number {
  switch (kind) {
    case 'working':
      return 90
    case 'procedures':
      return 80
    case 'facts':
      return 70
    case 'recent':
      return 60
    case 'reflections':
      return 50
    case 'episodes':
      return 40
    default:
      return 50
  }
}

export function memoryBlock(config: MemoryBlockConfig): MemoryBlock {
  const kind = config.kind ?? 'custom'
  return {
    _tag: 'MemoryBlock' as const,
    id: config.id,
    kind,
    priority: config.priority ?? defaultPriority(kind),
    budget: config.budget,
    render: config.render,
    tools: config.tools,
    captureTurn: config.captureTurn,
    captureToolEvent: config.captureToolEvent,
    flush: config.flush,
    approveProposal: config.approveProposal,
  }
}

export function memory(config: MemoryConfig): Memory {
  const pending = new Set<Promise<unknown>>()
  const memoryStorage = resolveMemoryStorage(config)
  const records = memoryStorage.records

  registerInspectableResource({
    resource: `memory:${encodePart(config.id)}`,
    kind: 'memory',
    description: `Memory: ${config.id}`,
    operations: ['list'],
    store: records,
    defaultPrefix: `memory:${encodePart(config.id)}:`,
    metadata: {
      memoryId: config.id,
      blocks: config.blocks.map((block) => ({
        id: block.id,
        kind: block.kind,
        priority: block.priority,
      })),
      namespace: typeof config.namespace === 'string' ? config.namespace : 'dynamic',
      backend: memoryStorage.backend,
    },
  })

  async function resolveNamespace(input: Record<string, unknown> = {}, promptId?: string, override?: string) {
    return resolveMemoryNamespace(config.namespace, { input, promptId, override })
  }

  async function createContext(
    input: Record<string, unknown> = {},
    options: Partial<MemoryRuntimeOptions> & { input?: Record<string, unknown> } = {},
  ): Promise<MemoryBlockContext> {
    const namespace = await resolveNamespace(input, options.promptId, options.namespace)
    const activeStorage = resolveRuntimeStorage(memoryStorage, options)
    return {
      storage: activeStorage.storage,
      records: activeStorage.records,
      vectors: activeStorage.vectors,
      namespace,
      memoryId: config.id,
      traceId: options.traceId,
      promptId: options.promptId,
      input,
      propose: async (candidate, proposalOptions) =>
        createProposal(activeStorage, namespace, proposalOptions.block, candidate, proposalOptions.source),
    }
  }

  async function createProposal(
    activeStorage: ResolvedMemoryStorage,
    namespace: string,
    block: MemoryBlock,
    candidate: unknown,
    source?: MemoryProposal['source'],
  ): Promise<string> {
    const proposalId = id('proposal')
    const timestamp = now()
    const proposal: MemoryProposal = {
      id: proposalId,
      memoryId: config.id,
      blockId: block.id,
      blockKind: block.kind,
      namespace,
      status: 'pending',
      candidate,
      source,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await activeStorage.records.put(`${proposalPrefix(config.id, namespace)}${proposalId}`, toJsonObject({ ...proposal }))
    emitBlockWrite(
      {
        storage: activeStorage.storage,
        records: activeStorage.records,
        vectors: activeStorage.vectors,
        namespace,
        memoryId: config.id,
        traceId: source?.traceId,
        promptId: source?.promptId,
      },
      block,
      'propose',
      {
        entryKey: proposalId,
        writeMode: 'propose',
        proposalStatus: 'pending',
        ...proposalSourceAttributes(source),
        snapshot: proposal,
      },
    )
    return proposalId
  }

  function captureConfig(): ResolvedCaptureConfig {
    return {
      mode: config.capture?.mode ?? 'afterResponse',
      waitUntil: config.capture?.waitUntil,
    }
  }

  function schedule(task: Promise<unknown>) {
    const tracked = task.finally(() => pending.delete(tracked))
    pending.add(tracked)
    const capture = captureConfig()
    if (capture.mode === 'afterResponse' && capture.waitUntil) {
      capture.waitUntil(tracked)
      return tracked
    }
    return tracked
  }

  async function runCaptureTurn(
    turn: MemoryTurn,
    options: Partial<MemoryRuntimeOptions> & { input?: Record<string, unknown> } = {},
  ) {
    const ctx = await createContext(options.input, options)
    for (const block of config.blocks) {
      await block.captureTurn?.(turn, ctx)
    }
  }

  async function runCaptureToolEvent(
    event: MemoryToolEvent,
    options: Partial<MemoryRuntimeOptions> & { input?: Record<string, unknown> } = {},
  ) {
    const ctx = await createContext(options.input, options)
    for (const block of config.blocks) {
      await block.captureToolEvent?.(event, ctx)
    }
  }

  const api: Memory = {
    _tag: 'Memory',
    id: config.id,
    blocks: Object.freeze([...config.blocks]),
    config,
    asContext(options) {
      return contextWithFullPromptInput({
        id: `memory:${config.id}`,
        description: `Memory: ${config.id}`,
        priority: options?.priority ?? 55,
        system: async ({ input }) => {
          const ctx = await createContext(input as Record<string, unknown>)
          const rendered: Array<{ block: MemoryBlock; text: string }> = []
          for (const block of [...config.blocks].sort((a, b) => b.priority - a.priority)) {
            const text = await block.render?.(ctx)
            if (text) rendered.push({ block, text })
          }
          if (rendered.length === 0) return ''
          const budgeted = renderBudgetedMemoryBlocksWithDecision(rendered, config.budget)
          if (budgeted.budgetDecision) {
            emitMemoryRenderObservation(ctx, config.id, budgeted.budgetDecision)
          }
          return budgeted.text
        },
        tools: ({ input }) => {
          return api.asTools({ input: input as Record<string, unknown> })
        },
      }, 'memory')
    },
    asTools(options) {
      const tools: AnyToolSet = {}
      const blocksWithTools = config.blocks.filter(
        (block): block is MemoryBlock & { tools: NonNullable<MemoryBlock['tools']> } => !!block.tools,
      )
      if (blocksWithTools.length === 0) return tools
      const input = options?.input ?? {}
      const namespace = resolveMemoryNamespaceSync(config.namespace, {
        input,
        override: options?.namespace,
        boundary: `memory("${config.id}").asTools()`,
      })
      for (const block of blocksWithTools) {
        const activeStorage = memoryStorage
        const maybeTools = block.tools({
          storage: activeStorage.storage,
          records: activeStorage.records,
          vectors: activeStorage.vectors,
          namespace,
          memoryId: config.id,
          input,
          propose: async (candidate, proposalOptions) =>
            createProposal(activeStorage, namespace, proposalOptions.block, candidate, proposalOptions.source),
        })
        if (isPromiseLike(maybeTools)) {
          throw new Error(
            `Memory block "${block.id}" returned async tools from memory("${config.id}").asTools(), ` +
              'but tool collection is synchronous. Return tools synchronously or expose them through an async-capable surface.',
          )
        }
        Object.assign(tools, maybeTools)
      }
      return tools
    },
    async captureTurn(turn, options = {}) {
      const task = runCaptureTurn(turn, options)
      if (captureConfig().mode === 'inline') {
        await task
      } else {
        schedule(task)
      }
    },
    async captureToolEvent(event, options = {}) {
      const task = runCaptureToolEvent(event, options)
      if (captureConfig().mode === 'inline') {
        await task
      } else {
        schedule(task)
      }
    },
    async flush(options = {}) {
      const ctx = await createContext(options.input, options)
      await Promise.all([...pending])
      for (const block of config.blocks) {
        await block.flush?.(ctx)
      }
    },
    proposals: {
      async list(options = {}) {
        const namespace = await resolveNamespace(options.input, options.promptId, options.namespace)
        const result = await records.list(proposalPrefix(config.id, namespace), {
          filter: {
            ...(options.blockId ? { blockId: options.blockId } : {}),
            ...(options.status ? { status: options.status } : {}),
          },
        })
        return result.entries.map((entry) => entry.value as unknown as MemoryProposal)
      },
      async approve(proposalId, options = {}) {
        const namespace = await resolveNamespace(options.input, options.promptId, options.namespace)
        const proposal = await findProposal(records, config.id, proposalId, namespace)
        if (!proposal) throw new Error(`Memory proposal "${proposalId}" was not found.`)
        assertPendingProposal(proposal, 'approved')
        const block = config.blocks.find((candidate) => candidate.id === proposal.blockId)
        if (!block) throw new Error(`Memory proposal "${proposalId}" references unknown block "${proposal.blockId}".`)
        const ctx = await createContext(
          {},
          { namespace: proposal.namespace, promptId: proposal.source?.promptId, traceId: proposal.source?.traceId },
        )
        await block.approveProposal?.(proposal, ctx, options.edit)
        proposal.status = 'approved'
        proposal.updatedAt = now()
        await records.put(`${proposalPrefix(config.id, proposal.namespace)}${proposal.id}`, toJsonObject({ ...proposal }))
        emitBlockWrite(ctx, block, 'approveProposal', {
          entryKey: proposal.id,
          proposalStatus: 'approved',
          ...proposalSourceAttributes(proposal.source),
          snapshot: proposal,
        })
      },
      async reject(proposalId, options = {}) {
        const namespace = await resolveNamespace(options.input, options.promptId, options.namespace)
        const proposal = await findProposal(records, config.id, proposalId, namespace)
        if (!proposal) throw new Error(`Memory proposal "${proposalId}" was not found.`)
        assertPendingProposal(proposal, 'rejected')
        proposal.status = 'rejected'
        proposal.reason = options.reason
        proposal.updatedAt = now()
        await records.put(`${proposalPrefix(config.id, proposal.namespace)}${proposal.id}`, toJsonObject({ ...proposal }))
        emitBlockWrite(
          {
            storage: memoryStorage.storage,
            records,
            vectors: memoryStorage.vectors,
            namespace: proposal.namespace,
            memoryId: config.id,
            promptId: proposal.source?.promptId,
            traceId: proposal.source?.traceId,
          },
          { id: proposal.blockId, kind: proposal.blockKind },
          'rejectProposal',
          {
            entryKey: proposal.id,
            proposalStatus: 'rejected',
            ...proposalSourceAttributes(proposal.source),
            snapshot: proposal,
          },
        )
      },
      async edit(proposalId, patch, options = {}) {
        const namespace = await resolveNamespace(options.input, options.promptId, options.namespace)
        const proposal = await findProposal(records, config.id, proposalId, namespace)
        if (!proposal) throw new Error(`Memory proposal "${proposalId}" was not found.`)
        assertPendingProposal(proposal, 'edited')
        proposal.candidate =
          isRecord(proposal.candidate) && isRecord(patch) ? { ...proposal.candidate, ...patch } : patch
        proposal.updatedAt = now()
        await records.put(`${proposalPrefix(config.id, proposal.namespace)}${proposal.id}`, toJsonObject({ ...proposal }))
      },
    },
  }

  return Object.freeze(api)
}

/**
 * Enforce the beta proposal lifecycle: only pending proposals may transition.
 */
function assertPendingProposal(proposal: MemoryProposal, operation: 'approved' | 'rejected' | 'edited'): void {
  if (proposal.status === 'pending') return
  throw new Error(
    `Memory proposal "${proposal.id}" is ${proposal.status} and cannot be ${operation}. ` +
      'Only pending proposals can be changed.',
  )
}

/**
 * Flatten proposal provenance into stable span/event attributes.
 */
function proposalSourceAttributes(source: MemoryProposal['source'] | undefined): Record<string, string> {
  return {
    ...(source?.turnId ? { proposalSourceTurnId: source.turnId } : {}),
    ...(source?.traceId ? { proposalSourceTraceId: source.traceId } : {}),
    ...(source?.promptId ? { proposalSourcePromptId: source.promptId } : {}),
    ...(source?.toolCallId ? { proposalSourceToolCallId: source.toolCallId } : {}),
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof value === 'object' && 'then' in value
}

async function findProposal(
  records: RecordStore,
  memoryId: string,
  proposalId: string,
  namespace?: string,
): Promise<MemoryProposal | null> {
  if (namespace) {
    const value = await records.get(`${proposalPrefix(memoryId, namespace)}${proposalId}`)
    return value ? (value as unknown as MemoryProposal) : null
  }
  const result = await records.list(`memory:${encodePart(memoryId)}:`)
  const entry = result.entries.find((candidate) => candidate.key.endsWith(`:proposal:${proposalId}`))
  return entry ? (entry.value as unknown as MemoryProposal) : null
}

export function recentMessages(config: { id: string; maxMessages?: number; priority?: number }): MemoryBlock & {
  addTurn(turn: MemoryTurn, options: MemoryRuntimeOptions): Promise<void>
  list(options: MemoryRuntimeOptions): Promise<MemoryMessage[]>
  clear(options: MemoryRuntimeOptions): Promise<void>
} {
  const maxMessages = config.maxMessages ?? 10

  async function addTurn(turn: MemoryTurn, options: MemoryRuntimeOptions) {
    const startedAt = now()
    const prefix = blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id)
    const existing = await list({ ...options, memoryId: options.memoryId ?? 'standalone' })
    const messages = [...existing, ...turn.messages].slice(-maxMessages)
    await clear({ ...options, memoryId: options.memoryId ?? 'standalone' })
    for (let index = 0; index < messages.length; index++) {
      await options.records.put(
        `${prefix}${String(index).padStart(6, '0')}`,
        toJsonObject({
          ...messages[index],
          order: index,
          createdAt: now(),
          updatedAt: now(),
        }),
      )
    }
    emitBlockWrite(options, { id: config.id, kind: 'recent' }, 'addTurn', {
      content: turn.messages
        .map(memoryMessageLine)
        .join('\n')
        .slice(0, 200),
      snapshot: messages.map((message, index) => ({ key: `${prefix}${String(index).padStart(6, '0')}`, ...message })),
      diff: {
        before: existing,
        after: messages,
        added: turn.messages.map((message) => ({
          preview: memoryMessageLine(message).slice(0, 240),
        })),
      },
      durationMs: now() - startedAt,
    })
  }

  async function list(options: MemoryRuntimeOptions): Promise<MemoryMessage[]> {
    const startedAt = now()
    const result = await options.records.list(blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id))
    const sortedEntries = [...result.entries].sort((a, b) => String(a.key).localeCompare(String(b.key)))
    const messages = sortedEntries.map((entry) => ({
        role: String(entry.value.role ?? ''),
        content: storedContentText(entry.value.content),
        metadata: isRecord(entry.value.metadata) ? entry.value.metadata : undefined,
      }))
    emitBlockRead(options, { id: config.id, kind: 'recent' }, 'list', messages.length, startedAt, {
      snapshot: messages,
      recall: {
        results: sortedEntries.map((entry) =>
          valueToEntry({
            key: entry.key,
            value: {
              content: memoryMessageLine({ role: entry.value.role, content: entry.value.content }),
              metadata: isRecord(entry.value.metadata) ? entry.value.metadata : {},
              createdAt: typeof entry.value.createdAt === 'number' ? entry.value.createdAt : 0,
              updatedAt: typeof entry.value.updatedAt === 'number' ? entry.value.updatedAt : 0,
            },
          }),
        ),
      },
    })
    return messages
  }

  async function clear(options: MemoryRuntimeOptions) {
    const result = await options.records.list(blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id))
    await Promise.all(result.entries.map((entry) => options.records.delete(entry.key)))
    emitBlockWrite(options, { id: config.id, kind: 'recent' }, 'clear', {
      snapshot: [],
      diff: {
        before: result.entries.map((entry) => entry.value),
        after: [],
        removed: result.entries.map((entry) => ({
          key: entry.key,
          preview: memoryMessageLine({ role: entry.value.role, content: entry.value.content }).slice(0, 240),
        })),
      },
    })
  }

  const block = memoryBlock({
    id: config.id,
    kind: 'recent',
    priority: config.priority,
    captureTurn: addTurn,
    render: async (ctx) => {
      const messages = await list(ctx)
      if (messages.length === 0) return ''
      return ['Recent messages:', ...messages.map((message) => `- ${message.role}: ${message.content}`)].join('\n')
    },
  })

  return Object.assign(block, { addTurn, list, clear })
}

export function workingState<T extends z.ZodType>(config: {
  id: string
  schema: T
  priority?: number
}): MemoryBlock & {
  get(options: MemoryRuntimeOptions): Promise<z.infer<T> | null>
  set(value: z.infer<T>, options: MemoryRuntimeOptions): Promise<void>
  patch(value: Partial<z.infer<T>>, options: MemoryRuntimeOptions): Promise<void>
  clear(options: MemoryRuntimeOptions): Promise<void>
} {
  function key(options: MemoryRuntimeOptions) {
    return `${blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id)}state`
  }

  async function get(options: MemoryRuntimeOptions): Promise<z.infer<T> | null> {
    const startedAt = now()
    const value = await options.records.get(key(options))
    const state = value ? (value.state as z.infer<T>) : null
    emitBlockRead(options, { id: config.id, kind: 'working' }, 'get', state ? 1 : 0, startedAt, {
      snapshot: state,
      metadata: { schema: zodToJsonSchema(config.schema) },
    })
    return state
  }

  async function set(value: z.infer<T>, options: MemoryRuntimeOptions) {
    const parsed = config.schema.parse(value)
    const beforeValue = await options.records.get(key(options))
    const before = beforeValue ? beforeValue.state : null
    await options.records.put(
      key(options),
      toJsonObject({ state: parsed as Record<string, unknown>, createdAt: now(), updatedAt: now() }),
    )
    emitBlockWrite(options, { id: config.id, kind: 'working' }, 'set', {
      snapshot: parsed,
      diff: { before, after: parsed },
      metadata: { schema: zodToJsonSchema(config.schema) },
    })
  }

  async function patch(value: Partial<z.infer<T>>, options: MemoryRuntimeOptions) {
    const current = (await get(options)) ?? {}
    await set({ ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) } as z.infer<T>, options)
  }

  async function clear(options: MemoryRuntimeOptions) {
    const beforeValue = await options.records.get(key(options))
    const before = beforeValue ? beforeValue.state : null
    await options.records.delete(key(options))
    emitBlockWrite(options, { id: config.id, kind: 'working' }, 'clear', {
      snapshot: null,
      diff: { before, after: null },
      metadata: { schema: zodToJsonSchema(config.schema) },
    })
  }

  const block = memoryBlock({
    id: config.id,
    kind: 'working',
    priority: config.priority,
    render: async (ctx) => {
      const state = await get(ctx)
      return state ? `Working state:\n${JSON.stringify(state, null, 2)}` : ''
    },
  })

  return Object.assign(block, { get, set, patch, clear })
}

export function episodes(config: {
  id: string
  embed?: EmbedLike
  priority?: number
  /**
   * Built-in rendering strategy for episode memory.
   *
   * `list`/`recent` renders latest entries. `semantic` uses `recall()` with
   * the provided query and keeps namespace/block filters applied by the block.
   * Set `false` to disable prompt rendering for this block.
   */
  render?: false | MemoryEntryRenderStrategy
  /**
   * Optional retention policy descriptor (e.g. `"90d"`). When set, it rides on
   * every read/write event's metadata so devtools can surface the real policy
   * instead of inferring one. Purely descriptive — enforcement is the caller's
   * job (see `evict`).
   */
  retention?: string
}): MemoryBlock & {
  record(entry: { content: string; metadata?: Record<string, unknown> }, options: MemoryRuntimeOptions): Promise<string>
  recall(
    query: string,
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]>
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter }): Promise<MemoryEntryApi[]>
  delete(key: string, options: MemoryRuntimeOptions): Promise<void>
  /**
   * Delete an entry as part of a retention sweep. Identical to `delete` but
   * emits a `evict` write op carrying GC telemetry (`lastGcAt`, `lastGcEvicted`)
   * so the eviction is attributable in devtools rather than a silent drop.
   */
  evict(key: string, options: MemoryRuntimeOptions & { evictedCount?: number; gcAt?: number }): Promise<void>
} {
  const embed = normalizeEmbed(config.embed)

  function retentionMeta(extra?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!config.retention && !extra) return undefined
    return { ...(config.retention ? { retentionPolicy: config.retention } : {}), ...extra }
  }

  async function record(
    entry: { content: string; metadata?: Record<string, unknown> },
    options: MemoryRuntimeOptions,
  ): Promise<string> {
    const key = `${blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id)}${id('episode')}`
    const embedding = embed ? await embed(entry.content) : undefined
    const timestamp = now()
    await options.records.put(
      key,
      toJsonObject({
        content: entry.content,
        metadata: entry.metadata ?? {},
        blockKind: 'episodes',
        blockId: config.id,
        namespace: options.namespace,
        ...(embedding ? { embedding } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )
    if (embedding && options.vectors) {
      await options.vectors.upsert([{ key, dense: embedding, metadata: vectorMetadata(config.id, options.namespace, entry.metadata) }])
    }
    emitBlockWrite(options, { id: config.id, kind: 'episodes' }, 'record', {
      entryKey: key,
      content: entry.content.slice(0, 200),
      ...(retentionMeta() ? { metadata: retentionMeta() } : {}),
      diff: { added: [{ key, preview: entry.content.slice(0, 240) }] },
      snapshot: {
        key,
        content: entry.content,
        metadata: entry.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    })
    return key
  }

  async function list(
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    const result = await options.records.list(
      blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id),
      {
        limit: options.limit,
        filter: options.filter,
      },
    )
    const entries = result.entries.map((entry) => valueToEntry(entry))
    emitBlockRead(options, { id: config.id, kind: 'episodes' }, 'list', entries.length, startedAt, {
      ...(retentionMeta() ? { metadata: retentionMeta() } : {}),
      recall: { results: entries },
    })
    return entries
  }

  async function recall(
    query: string,
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    if (embed && options.vectors) {
      const queryEmbedding = await embed(query)
      const results = await options.vectors.search({
        mode: 'dense',
        dense: queryEmbedding,
        limit: options.limit,
        filter: mergeVectorFilter(config.id, options.namespace, options.filter),
      })
      const entries = await hydrateVectorHits(options.records, results)
      const topScore = entries.length ? entries[0].score : undefined
      emitBlockRead(options, { id: config.id, kind: 'episodes' }, 'recall', entries.length, startedAt, {
        query,
        ...(typeof topScore === 'number' ? { score: topScore } : {}),
        ...(retentionMeta() ? { metadata: retentionMeta() } : {}),
        recall: { query, results: entries },
      })
      return entries
    }
    return list(options)
  }

  async function deleteEntry(key: string, options: MemoryRuntimeOptions) {
    const before = await options.records.get(key)
    await options.records.delete(key)
    await options.vectors?.delete([key])
    emitBlockWrite(options, { id: config.id, kind: 'episodes' }, 'delete', {
      entryKey: key,
      ...(retentionMeta() ? { metadata: retentionMeta() } : {}),
      ...(before
        ? {
            diff: {
              removed: [{ key, preview: previewText(before.content) }],
            },
          }
        : {}),
    })
  }

  async function evict(key: string, options: MemoryRuntimeOptions & { evictedCount?: number; gcAt?: number }) {
    await options.records.delete(key)
    await options.vectors?.delete([key])
    const gcMeta = retentionMeta({
      lastGcAt: options.gcAt ?? now(),
      ...(typeof options.evictedCount === 'number' ? { lastGcEvicted: options.evictedCount } : {}),
    })
    emitBlockWrite(options, { id: config.id, kind: 'episodes' }, 'evict', {
      entryKey: key,
      ...(gcMeta ? { metadata: gcMeta } : {}),
    })
  }

  const block = memoryBlock({
    id: config.id,
    kind: 'episodes',
    priority: config.priority,
    captureTurn: async (turn, ctx) => {
      for (const message of turn.messages) {
        await record({ content: memoryMessageLine(message), metadata: message.metadata }, ctx)
      }
    },
    captureToolEvent: async (event, ctx) => {
      await record({ content: `tool:${event.toolName}: ${JSON.stringify(event.result ?? event.error ?? null)}` }, ctx)
    },
    render: async (ctx) => {
      if (config.render === false) return ''
      return renderMemoryEntries(ctx, { list, find: recall }, {
        heading: 'Relevant episodes:',
        defaultLimit: 5,
        strategy: config.render,
      })
    },
  })

  return Object.assign(block, { record, recall, list, delete: deleteEntry, evict })
}

interface ExtractiveCandidate {
  content: string
  metadata?: Record<string, unknown>
  confidence?: number
}

type ExtractFn = (turn: MemoryTurn, ctx: MemoryBlockContext) => Promise<ExtractiveCandidate[]> | ExtractiveCandidate[]
type ExtractiveBlockApi = {
  add(entry: ExtractiveCandidate, options: MemoryRuntimeOptions): Promise<string>
  find(
    query: string,
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]>
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter }): Promise<MemoryEntryApi[]>
  delete(key: string, options: MemoryRuntimeOptions): Promise<void>
}

type ExtractiveRenderConfig =
  | false
  | MemoryEntryRenderStrategy
  | ((ctx: MemoryBlockContext, api: ExtractiveBlockApi) => Promise<string> | string)

function extractiveBlock(
  kind: 'facts' | 'procedures',
  config: {
    id: string
    embed?: EmbedLike
    extract?:
      | ExtractFn
      | {
          generate: (options: { model: unknown; system?: string; prompt: string }) => Promise<{ text: string }>
          model: unknown
        }
    write?: { mode?: MemoryWriteMode }
    policy?: MemoryPolicy<ExtractiveCandidate>
    priority?: number
    /**
     * Prompt rendering for this extractive block.
     *
     * Pass a function for full control, `false` to disable rendering, or a
     * strategy object. `semantic` calls `find()` with the supplied query;
     * `list`/`recent` renders latest entries.
     */
    render?: ExtractiveRenderConfig
  },
): MemoryBlock & {
  add(entry: ExtractiveCandidate, options: MemoryRuntimeOptions): Promise<string>
  find(
    query: string,
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]>
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter }): Promise<MemoryEntryApi[]>
  delete(key: string, options: MemoryRuntimeOptions): Promise<void>
  render(options: MemoryRuntimeOptions): Promise<string>
} {
  const embed = normalizeEmbed(config.embed)
  const writeMode = config.write?.mode ?? 'propose'

  async function add(entry: ExtractiveCandidate, options: MemoryRuntimeOptions): Promise<string> {
    const key = `${blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id)}${id(kind.slice(0, -1))}`
    const embedding = embed ? await embed(entry.content) : undefined
    const timestamp = now()
    const metadata = entry.metadata ?? {}
    const confidence = entry.confidence ?? 1
    await options.records.put(
      key,
      toJsonObject({
        content: entry.content,
        metadata,
        confidence,
        blockKind: kind,
        blockId: config.id,
        namespace: options.namespace,
        ...(embedding ? { embedding } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )
    if (embedding && options.vectors) {
      await options.vectors.upsert([{ key, dense: embedding, metadata: vectorMetadata(config.id, options.namespace, metadata) }])
    }
    emitBlockWrite(options, { id: config.id, kind }, 'add', {
      entryKey: key,
      content: entry.content.slice(0, 200),
      writeMode,
      diff: { added: [{ key, preview: entry.content.slice(0, 240) }] },
      snapshot: {
        key,
        content: entry.content,
        metadata,
        confidence,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    })
    return key
  }

  async function list(
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    const result = await options.records.list(
      blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id),
      {
        limit: options.limit,
        filter: options.filter,
      },
    )
    const entries = result.entries.map((entry) => valueToEntry(entry))
    emitBlockRead(options, { id: config.id, kind }, 'list', entries.length, startedAt, { recall: { results: entries } })
    return entries
  }

  async function find(
    query: string,
    options: MemoryRuntimeOptions & { limit?: number; filter?: ExactFilter },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    if (embed && options.vectors) {
      const queryEmbedding = await embed(query)
      const results = await options.vectors.search({
        mode: 'dense',
        dense: queryEmbedding,
        limit: options.limit,
        filter: mergeVectorFilter(config.id, options.namespace, options.filter),
      })
      const entries = await hydrateVectorHits(options.records, results)
      emitBlockRead(options, { id: config.id, kind }, 'find', entries.length, startedAt, {
        query,
        recall: { query, results: entries },
      })
      return entries
    }
    return list(options)
  }

  async function render(options: MemoryRuntimeOptions): Promise<string> {
    const entries = await list({ ...options, limit: 8 })
    if (entries.length === 0) return ''
    const heading = kind === 'procedures' ? 'Operating Memory' : 'Facts'
    return [heading, ...entries.map((entry) => `- ${entry.content}`)].join('\n')
  }

  async function deleteEntry(key: string, options: MemoryRuntimeOptions) {
    const before = await options.records.get(key)
    await options.records.delete(key)
    await options.vectors?.delete([key])
    emitBlockWrite(options, { id: config.id, kind }, 'delete', {
      entryKey: key,
      ...(before
        ? {
            diff: {
              removed: [{ key, preview: previewText(before.content) }],
            },
          }
        : {}),
    })
  }

  const api: ExtractiveBlockApi = {
    add,
    find,
    list,
    delete: deleteEntry,
  }

  async function extract(turn: MemoryTurn, ctx: MemoryBlockContext): Promise<ExtractiveCandidate[]> {
    if (!config.extract) return []
    if (typeof config.extract === 'function') return config.extract(turn, ctx)
    const transcript = turn.messages.map(memoryMessageLine).join('\n')
    const result = await config.extract.generate({
      model: config.extract.model,
      system: `Extract ${kind} from the transcript. Return JSON array with content, confidence, and metadata.`,
      prompt: transcript,
    })
    return parseCandidates(result.text)
  }

  async function captureTurn(turn: MemoryTurn, ctx: MemoryBlockContext) {
    const candidates = await extract(turn, ctx)
    for (const candidate of candidates) {
      const blockIdentity = { id: config.id, kind }
      const safe = await applyMemoryPolicy(candidate, config.policy, ctx, {
        policyIdPrefix: `memory.${config.id}.policy`,
        now,
        onDecision: (event) => emitMemoryPolicyDecision(ctx, blockIdentity, event),
      })
      if (!safe) continue
      if (writeMode === 'auto') {
        await add(safe, ctx)
      } else if (writeMode === 'propose') {
        await ctx.propose(safe, { block, source: turn.source })
      }
    }
  }

  const configuredRender = config.render
  const blockRender =
    configuredRender === false
      ? undefined
      : async (ctx: MemoryBlockContext) => {
          if (!configuredRender) return render(ctx)
          if (isMemoryEntryRenderStrategy(configuredRender)) {
            const heading = kind === 'procedures' ? 'Operating Memory' : 'Facts'
            return renderMemoryEntries(ctx, api, {
              heading,
              defaultLimit: 8,
              strategy: configuredRender,
            })
          }
          return configuredRender(ctx, api)
        }

  const block = memoryBlock({
    id: config.id,
    kind,
    priority: config.priority,
    captureTurn,
    render: blockRender,
    approveProposal: async (proposal, ctx, edit) => {
      await add((edit ?? proposal.candidate) as ExtractiveCandidate, ctx)
    },
  })

  const directRender = async (options: MemoryRuntimeOptions & { input?: Record<string, unknown> }) =>
    blockRender
      ? blockRender({
          ...options,
          input: options.input,
          propose: async () => {
            throw new Error('Cannot create memory proposals while rendering a standalone block.')
          },
        })
      : render(options)

  return Object.assign(block, { add, find, list, delete: deleteEntry, render: directRender })
}

function parseCandidates(text: string): ExtractiveCandidate[] {
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ExtractiveCandidate => isRecord(item) && typeof item.content === 'string')
  } catch {
    return []
  }
}

export function facts(config: Parameters<typeof extractiveBlock>[1]) {
  return extractiveBlock('facts', config)
}

export function procedures(config: Parameters<typeof extractiveBlock>[1]) {
  return extractiveBlock('procedures', config)
}

export function reflections(config: {
  id: string
  generate?: (options: { model: unknown; system?: string; prompt: string }) => Promise<{ text: string }>
  model?: unknown
  embed?: EmbedLike
  priority?: number
}) {
  const block = extractiveBlock('facts', {
    id: config.id,
    embed: config.embed,
    priority: config.priority ?? defaultPriority('reflections'),
  })
  return Object.assign(block, {
    kind: 'reflections' as const,
    async reflect(options: MemoryRuntimeOptions & { input?: string }) {
      if (!config.generate) return undefined
      const result = await config.generate({
        model: config.model,
        system: 'Create a concise reflection from the supplied memories.',
        prompt: options.input ?? '',
      })
      return block.add({ content: result.text, confidence: 1 }, options)
    },
  })
}
