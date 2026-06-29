import { z } from 'zod'
import { context } from '../prompt/context'
import type { AnyToolSet } from '../types'
import type { Context } from '../prompt/context-types'
import type { CruxStore, JsonObject, ScoredEntry } from '../store/types'
import { inMemoryCruxStore } from '../store/memory'
import type { DenseEmbedding } from '../embedding'
import { getRuntime } from '../runtime/runtime'
import { observe } from '../observability'
import { registerInspectableResource } from '../runtime-bridge/resources'
import {
  resolveMemoryNamespace,
  resolveMemoryNamespaceSync,
  type MemoryNamespace,
} from './namespace'
import {
  isMemoryEntryRenderStrategy,
  renderBudgetedMemoryBlocks,
  renderMemoryEntries,
  type MemoryBudget,
  type MemoryEntryRenderStrategy,
} from './rendering'

export type MemoryBlockKind = 'recent' | 'working' | 'episodes' | 'facts' | 'procedures' | 'reflections' | 'custom'
export type MemoryWriteMode = 'propose' | 'auto' | 'manual'
export type MemoryProposalStatus = 'pending' | 'approved' | 'rejected'
export type MemoryCaptureMode = 'inline' | 'afterResponse' | 'detached'
export type { MemoryNamespace } from './namespace'
export type {
  MemoryBudget,
  MemoryEntryRenderStrategy,
  MemoryListRenderStrategy,
  MemoryRenderQuery,
  MemorySemanticRenderStrategy,
} from './rendering'

/** Capture scheduling options for memory turn and tool-event writes. */
export interface MemoryCaptureConfig {
  /**
   * Capture scheduling mode.
   *
   * - `inline`: await block capture before `captureTurn()`/`captureToolEvent()` resolves.
   * - `afterResponse`: start capture after generation and hand it to `waitUntil` when provided.
   * - `detached`: start capture in the background; `flush()` can still await pending work.
   */
  mode?: MemoryCaptureMode
  /** Runtime hook for environments that keep background work alive after a response. */
  waitUntil?: (promise: Promise<unknown>) => void
}

export interface MemoryRuntimeOptions {
  store: CruxStore
  namespace: string
  memoryId?: string
  traceId?: string
  promptId?: string
}

export interface MemoryToolEvent {
  toolCallId?: string
  toolName: string
  args?: unknown
  result?: unknown
  error?: string
}

export interface MemoryMessage {
  role: string
  content: string
  metadata?: Record<string, unknown>
}

export interface MemoryTurn {
  id?: string
  messages: MemoryMessage[]
  toolEvents?: MemoryToolEvent[]
  source?: {
    traceId?: string
    promptId?: string
  }
  metadata?: Record<string, unknown>
}

export interface MemoryProposal {
  id: string
  memoryId: string
  blockId: string
  blockKind: MemoryBlockKind
  namespace: string
  status: MemoryProposalStatus
  candidate: unknown
  source?: {
    turnId?: string
    traceId?: string
    promptId?: string
    toolCallId?: string
  }
  createdAt: number
  updatedAt: number
  reason?: string
}

export interface MemoryPolicy<TCandidate> {
  shouldRemember?: (candidate: TCandidate, ctx: MemoryBlockContext) => boolean | Promise<boolean>
  redact?: (candidate: TCandidate, ctx: MemoryBlockContext) => TCandidate | Promise<TCandidate>
  validate?: z.ZodType<TCandidate>
}

export interface MemoryBlockContext extends MemoryRuntimeOptions {
  input?: Record<string, unknown>
  propose(candidate: unknown, options: { block: MemoryBlock; source?: MemoryProposal['source'] }): Promise<string>
}

export interface MemoryBlock {
  readonly _tag: 'MemoryBlock'
  readonly id: string
  readonly kind: MemoryBlockKind
  readonly priority: number
  readonly budget?: MemoryBudget
  render?(ctx: MemoryBlockContext): Promise<string> | string
  tools?(ctx: MemoryBlockContext): AnyToolSet | Promise<AnyToolSet>
  captureTurn?(turn: MemoryTurn, ctx: MemoryBlockContext): Promise<void>
  captureToolEvent?(event: MemoryToolEvent, ctx: MemoryBlockContext): Promise<void>
  flush?(ctx: MemoryBlockContext): Promise<void>
  approveProposal?(proposal: MemoryProposal, ctx: MemoryBlockContext, edit?: unknown): Promise<void>
}

export interface MemoryBlockConfig {
  id: string
  kind?: MemoryBlockKind
  priority?: number
  /** Approximate token budget for this block's rendered body. */
  budget?: MemoryBudget
  render?: (ctx: MemoryBlockContext) => Promise<string> | string
  tools?: (ctx: MemoryBlockContext) => AnyToolSet | Promise<AnyToolSet>
  captureTurn?: (turn: MemoryTurn, ctx: MemoryBlockContext) => Promise<void>
  captureToolEvent?: (event: MemoryToolEvent, ctx: MemoryBlockContext) => Promise<void>
  flush?: (ctx: MemoryBlockContext) => Promise<void>
  approveProposal?: (proposal: MemoryProposal, ctx: MemoryBlockContext, edit?: unknown) => Promise<void>
}

export interface MemoryConfig {
  /** Stable identifier used in store keys, traces, and devtools resources. */
  id: string
  /** Store backing this memory instance. Defaults to an in-memory store. */
  store?: CruxStore
  /** Namespace scope for all reads, writes, tools, capture, and proposals. */
  namespace: MemoryNamespace
  /** Ordered memory blocks composed by this memory instance. */
  blocks: readonly MemoryBlock[]
  /**
   * Capture scheduling behavior for turn and tool-event writes.
   *
   * - `inline`: `captureTurn()` and `captureToolEvent()` await block capture before resolving.
   * - `afterResponse`: capture is started after generation and passed to `waitUntil` when provided.
   * - `detached`: capture starts in the background and can still be awaited with `flush()`.
   *
   * Defaults to `afterResponse`.
   */
  capture?: MemoryCaptureConfig
  /**
   * @deprecated Use `capture` instead. Legacy `deferred` maps to
   * `capture.mode: "afterResponse"` and legacy `manual` maps to
   * `capture.mode: "detached"` because capture still starts immediately.
   */
  processing?: {
    mode?: 'deferred' | 'inline' | 'manual'
    waitUntil?: (promise: Promise<unknown>) => void
  }
  /**
   * Approximate token budget for the composed memory context.
   *
   * Blocks are rendered in priority order. Block-level budgets trim individual
   * block bodies first, then this memory-level budget keeps higher-priority
   * sections before lower-priority sections. Counting uses the configured Crux
   * tokenizer.
   */
  budget?: MemoryBudget
}

export interface Memory {
  readonly _tag: 'Memory'
  readonly id: string
  readonly blocks: readonly MemoryBlock[]
  readonly config: MemoryConfig
  asContext(options?: { priority?: number }): Context
  asTools(options?: { input?: Record<string, unknown>; namespace?: string }): AnyToolSet
  captureTurn(
    turn: MemoryTurn,
    options?: Partial<MemoryRuntimeOptions> & { input?: Record<string, unknown> },
  ): Promise<void>
  captureToolEvent(
    event: MemoryToolEvent,
    options?: Partial<MemoryRuntimeOptions> & { input?: Record<string, unknown> },
  ): Promise<void>
  flush(options?: Partial<MemoryRuntimeOptions> & { input?: Record<string, unknown> }): Promise<void>
  proposals: {
    list(
      options?: {
        namespace?: string
        input?: Record<string, unknown>
        promptId?: string
        blockId?: string
        status?: MemoryProposalStatus
      },
    ): Promise<MemoryProposal[]>
    approve(
      id: string,
      options?: { namespace?: string; input?: Record<string, unknown>; promptId?: string; edit?: unknown },
    ): Promise<void>
    reject(
      id: string,
      options?: { namespace?: string; input?: Record<string, unknown>; promptId?: string; reason?: string },
    ): Promise<void>
    edit(
      id: string,
      patch: unknown,
      options?: { namespace?: string; input?: Record<string, unknown>; promptId?: string },
    ): Promise<void>
  }
}

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
    content: String(entry.value.content ?? ''),
    metadata,
    confidence: typeof entry.value.confidence === 'number' ? entry.value.confidence : undefined,
    score,
    createdAt: typeof entry.value.createdAt === 'number' ? entry.value.createdAt : 0,
    updatedAt: typeof entry.value.updatedAt === 'number' ? entry.value.updatedAt : 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject
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
  return attributes
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
    family: 'memory',
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
    span.end(omitSnapshot(attributes))
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
  if (typeof value === 'string') return value.slice(0, 240)
  try {
    return JSON.stringify(value)?.slice(0, 240) ?? String(value)
  } catch {
    return String(value).slice(0, 240)
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
    ...('before' in diff ? { before: diff.before } : {}),
    ...('after' in diff ? { after: diff.after } : {}),
    ...(diff.added ? { added: diff.added.map((entry) => ({ blockKind: args.blockKind, ...entry })) } : {}),
    ...(diff.removed ? { removed: diff.removed.map((entry) => ({ blockKind: args.blockKind, ...entry })) } : {}),
    ...(diff.updated ? { updated: diff.updated.map((entry) => ({ blockKind: args.blockKind, ...entry })) } : {}),
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
    ...body,
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

async function applyPolicy<T>(
  candidate: T,
  policy: MemoryPolicy<T> | undefined,
  ctx: MemoryBlockContext,
): Promise<T | null> {
  let next = candidate
  if (policy?.redact) {
    next = await policy.redact(next, ctx)
  }
  if (policy?.validate) {
    const parsed = policy.validate.safeParse(next)
    if (!parsed.success) return null
    next = parsed.data
  }
  if (policy?.shouldRemember) {
    const shouldRemember = await policy.shouldRemember(next, ctx)
    if (!shouldRemember) return null
  }
  return next
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
  const store = config.store ?? inMemoryCruxStore()

  registerInspectableResource({
    resource: `memory:${encodePart(config.id)}`,
    kind: 'memory',
    description: `Memory: ${config.id}`,
    operations: ['list'],
    store,
    defaultPrefix: `memory:${encodePart(config.id)}:`,
    metadata: {
      memoryId: config.id,
      blocks: config.blocks.map((block) => ({
        id: block.id,
        kind: block.kind,
        priority: block.priority,
      })),
      namespace: typeof config.namespace === 'string' ? config.namespace : 'dynamic',
      backend: config.store ? 'configured' : 'inMemory',
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
    return {
      store: options.store ?? store,
      namespace,
      memoryId: config.id,
      traceId: options.traceId,
      promptId: options.promptId,
      input,
      propose: async (candidate, proposalOptions) =>
        createProposal(options.store ?? store, namespace, proposalOptions.block, candidate, proposalOptions.source),
    }
  }

  async function createProposal(
    activeStore: CruxStore,
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
    await activeStore.set(`${proposalPrefix(config.id, namespace)}${proposalId}`, toJsonObject({ ...proposal }))
    emitBlockWrite(
      { store: activeStore, namespace, memoryId: config.id, traceId: source?.traceId, promptId: source?.promptId },
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
      mode: config.capture?.mode ?? legacyCaptureMode(config.processing?.mode),
      waitUntil: config.capture?.waitUntil ?? config.processing?.waitUntil,
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
      return context({
        id: `memory:${config.id}`,
        description: `Memory: ${config.id}`,
        family: 'memory',
        priority: options?.priority ?? 55,
        system: async ({ input }) => {
          const ctx = await createContext(input as Record<string, unknown>)
          const rendered: Array<{ block: MemoryBlock; text: string }> = []
          for (const block of [...config.blocks].sort((a, b) => b.priority - a.priority)) {
            const text = await block.render?.(ctx)
            if (text) rendered.push({ block, text })
          }
          if (rendered.length === 0) return ''
          return renderBudgetedMemoryBlocks(rendered, config.budget)
        },
        tools: ({ input }) => {
          return api.asTools({ input: input as Record<string, unknown> })
        },
      })
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
        const maybeTools = block.tools({
          store,
          namespace,
          memoryId: config.id,
          input,
          propose: async (candidate, proposalOptions) =>
            createProposal(store, namespace, proposalOptions.block, candidate, proposalOptions.source),
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
        const result = await store.list(proposalPrefix(config.id, namespace), {
          filter: {
            ...(options.blockId ? { blockId: options.blockId } : {}),
            ...(options.status ? { status: options.status } : {}),
          },
        })
        return result.entries.map((entry) => entry.value as unknown as MemoryProposal)
      },
      async approve(proposalId, options = {}) {
        const namespace = await resolveNamespace(options.input, options.promptId, options.namespace)
        const proposal = await findProposal(store, config.id, proposalId, namespace)
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
        await store.set(`${proposalPrefix(config.id, proposal.namespace)}${proposal.id}`, toJsonObject({ ...proposal }))
        emitBlockWrite(ctx, block, 'approveProposal', {
          entryKey: proposal.id,
          proposalStatus: 'approved',
          ...proposalSourceAttributes(proposal.source),
          snapshot: proposal,
        })
      },
      async reject(proposalId, options = {}) {
        const namespace = await resolveNamespace(options.input, options.promptId, options.namespace)
        const proposal = await findProposal(store, config.id, proposalId, namespace)
        if (!proposal) throw new Error(`Memory proposal "${proposalId}" was not found.`)
        assertPendingProposal(proposal, 'rejected')
        proposal.status = 'rejected'
        proposal.reason = options.reason
        proposal.updatedAt = now()
        await store.set(`${proposalPrefix(config.id, proposal.namespace)}${proposal.id}`, toJsonObject({ ...proposal }))
        emitBlockWrite(
          {
            store,
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
        const proposal = await findProposal(store, config.id, proposalId, namespace)
        if (!proposal) throw new Error(`Memory proposal "${proposalId}" was not found.`)
        assertPendingProposal(proposal, 'edited')
        proposal.candidate =
          isRecord(proposal.candidate) && isRecord(patch) ? { ...proposal.candidate, ...patch } : patch
        proposal.updatedAt = now()
        await store.set(`${proposalPrefix(config.id, proposal.namespace)}${proposal.id}`, toJsonObject({ ...proposal }))
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

function legacyCaptureMode(mode: NonNullable<MemoryConfig['processing']>['mode']): MemoryCaptureMode {
  switch (mode) {
    case 'inline':
      return 'inline'
    case 'manual':
      return 'detached'
    case 'deferred':
    default:
      return 'afterResponse'
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof value === 'object' && 'then' in value
}

async function findProposal(
  store: CruxStore,
  memoryId: string,
  proposalId: string,
  namespace?: string,
): Promise<MemoryProposal | null> {
  if (namespace) {
    const value = await store.get(`${proposalPrefix(memoryId, namespace)}${proposalId}`)
    return value ? (value as unknown as MemoryProposal) : null
  }
  const result = await store.list(`memory:${encodePart(memoryId)}:`)
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
      await options.store.set(
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
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
        .slice(0, 200),
      snapshot: messages.map((message, index) => ({ key: `${prefix}${String(index).padStart(6, '0')}`, ...message })),
      diff: {
        before: existing,
        after: messages,
        added: turn.messages.map((message) => ({
          preview: `${message.role}: ${message.content}`.slice(0, 240),
        })),
      },
      durationMs: now() - startedAt,
    })
  }

  async function list(options: MemoryRuntimeOptions): Promise<MemoryMessage[]> {
    const startedAt = now()
    const result = await options.store.list(blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id))
    const messages = result.entries
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .map((entry) => ({
        role: String(entry.value.role ?? ''),
        content: String(entry.value.content ?? ''),
        metadata: isRecord(entry.value.metadata) ? entry.value.metadata : undefined,
      }))
    emitBlockRead(options, { id: config.id, kind: 'recent' }, 'list', messages.length, startedAt, {
      snapshot: messages,
      recall: {
        results: result.entries
          .sort((a, b) => String(a.key).localeCompare(String(b.key)))
          .map((entry) =>
            valueToEntry({
              key: entry.key,
              value: {
                content: `${String(entry.value.role ?? '')}: ${String(entry.value.content ?? '')}`,
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
    const result = await options.store.list(blockPrefix(options.memoryId ?? 'standalone', options.namespace, config.id))
    await Promise.all(result.entries.map((entry) => options.store.delete(entry.key)))
    emitBlockWrite(options, { id: config.id, kind: 'recent' }, 'clear', {
      snapshot: [],
      diff: {
        before: result.entries.map((entry) => entry.value),
        after: [],
        removed: result.entries.map((entry) => ({
          key: entry.key,
          preview: `${String(entry.value.role ?? '')}: ${String(entry.value.content ?? '')}`.slice(0, 240),
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
    const value = await options.store.get(key(options))
    const state = value ? (value.state as z.infer<T>) : null
    emitBlockRead(options, { id: config.id, kind: 'working' }, 'get', state ? 1 : 0, startedAt, {
      snapshot: state,
      metadata: { schema: zodToJsonSchema(config.schema) },
    })
    return state
  }

  async function set(value: z.infer<T>, options: MemoryRuntimeOptions) {
    const parsed = config.schema.parse(value)
    const beforeValue = await options.store.get(key(options))
    const before = beforeValue ? beforeValue.state : null
    await options.store.set(
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
    const beforeValue = await options.store.get(key(options))
    const before = beforeValue ? beforeValue.state : null
    await options.store.delete(key(options))
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]>
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> }): Promise<MemoryEntryApi[]>
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
    await options.store.set(
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    const result = await options.store.list(
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    if (embed && options.store.vectorSearch) {
      const queryEmbedding = await embed(query)
      const results = await options.store.vectorSearch(queryEmbedding, {
        limit: options.limit,
        filter: { ...options.filter, blockId: config.id, namespace: options.namespace },
      })
      const entries = results.map((entry: ScoredEntry) => valueToEntry(entry, entry.score))
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
    const before = await options.store.get(key)
    await options.store.delete(key)
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
    await options.store.delete(key)
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
        await record({ content: `${message.role}: ${message.content}`, metadata: message.metadata }, ctx)
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]>
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> }): Promise<MemoryEntryApi[]>
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]>
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> }): Promise<MemoryEntryApi[]>
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
    await options.store.set(
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    const result = await options.store.list(
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
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]> {
    const startedAt = now()
    if (embed && options.store.vectorSearch) {
      const queryEmbedding = await embed(query)
      const results = await options.store.vectorSearch(queryEmbedding, {
        limit: options.limit,
        filter: { ...options.filter, blockId: config.id, namespace: options.namespace },
      })
      const entries = results.map((entry) => valueToEntry(entry, entry.score))
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
    const before = await options.store.get(key)
    await options.store.delete(key)
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
    const transcript = turn.messages.map((message) => `${message.role}: ${message.content}`).join('\n')
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
      const safe = await applyPolicy(candidate, config.policy, ctx)
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
  const store = extractiveBlock('facts', {
    id: config.id,
    embed: config.embed,
    priority: config.priority ?? defaultPriority('reflections'),
  })
  return Object.assign(store, {
    kind: 'reflections' as const,
    async reflect(options: MemoryRuntimeOptions & { input?: string }) {
      if (!config.generate) return undefined
      const result = await config.generate({
        model: config.model,
        system: 'Create a concise reflection from the supplied memories.',
        prompt: options.input ?? '',
      })
      return store.add({ content: result.text, confidence: 1 }, options)
    },
  })
}
