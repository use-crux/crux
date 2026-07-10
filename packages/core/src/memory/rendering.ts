import { countTokens } from '../shared/tokenizer'
import type { MemoryBlock, MemoryBlockContext, MemoryEntryApi, MemoryRuntimeOptions } from './block-system'

/** Approximate token budget for rendered memory text. */
export interface MemoryBudget {
  /**
   * Maximum tokens to render.
   *
   * Memory uses the configured Crux tokenizer for counting. When a block must
   * be shortened to fit, text is trimmed by character boundary until the
   * tokenizer reports it is within budget.
   */
  maxTokens?: number
}

export interface RenderedMemoryBlock {
  block: Pick<MemoryBlock, 'id' | 'priority' | 'budget'>
  text: string
}

/** Inspectable outcome of applying block and memory render budgets. */
export interface MemoryRenderBudgetDecision {
  /** Memory-level maximum token budget, when configured. */
  maxTokens?: number
  /** Tokens in the final rendered memory text after budget selection. */
  usedTokens: number
  /** Blocks that rendered text before budget selection. */
  candidateBlocks: string[]
  /** Blocks retained in the final memory text. */
  includedBlocks: string[]
  /** Blocks shortened by either a block-level or memory-level budget. */
  trimmedBlocks: string[]
  /** Blocks omitted because a block-level or memory-level budget had no room. */
  droppedBlocks: string[]
}

/** Rendered memory text plus optional budget decision metadata for observability. */
export interface RenderedBudgetedMemory {
  text: string
  budgetDecision?: MemoryRenderBudgetDecision
}

/** Query text, or a query factory that can derive text from render input. */
export type MemoryRenderQuery =
  | string
  | ((ctx: MemoryBlockContext) => string | Promise<string>)

/** Render entries by listing the latest entries for the block. */
export interface MemoryListRenderStrategy {
  /** List/recent rendering. Defaults to `list` when omitted. */
  strategy?: 'list' | 'recent'
  /** Maximum entries to include. */
  limit?: number
  /** Store-level filter forwarded to the block list operation. */
  filter?: Record<string, unknown>
}

/** Render entries by querying the block's semantic find/recall operation. */
export interface MemorySemanticRenderStrategy {
  /** Use the block's semantic search path. */
  strategy: 'semantic'
  /** Query text, or a function that derives it from render context. */
  query: MemoryRenderQuery
  /** Maximum entries to include. */
  limit?: number
  /** Store-level filter combined with the block's namespace and block id filters. */
  filter?: Record<string, unknown>
}

/** Built-in render strategies for memory entry blocks. */
export type MemoryEntryRenderStrategy = MemoryListRenderStrategy | MemorySemanticRenderStrategy

export interface MemoryEntryRenderApi {
  list(options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> }): Promise<MemoryEntryApi[]>
  find?(
    query: string,
    options: MemoryRuntimeOptions & { limit?: number; filter?: Record<string, unknown> },
  ): Promise<MemoryEntryApi[]>
}

/** True when a `render` value is one of the built-in render strategy objects. */
export function isMemoryEntryRenderStrategy(value: unknown): value is MemoryEntryRenderStrategy {
  return (
    !!value &&
    typeof value === 'object' &&
    ('strategy' in value || 'limit' in value || 'filter' in value || 'query' in value)
  )
}

/** Render a list of memory entries with the selected built-in strategy. */
export async function renderMemoryEntries(
  ctx: MemoryBlockContext,
  api: MemoryEntryRenderApi,
  args: {
    heading: string
    defaultLimit: number
    strategy?: MemoryEntryRenderStrategy
  },
): Promise<string> {
  const strategy = args.strategy ?? { strategy: 'list', limit: args.defaultLimit }
  const limit = strategy.limit ?? args.defaultLimit
  const filter = strategy.filter
  const entries =
    strategy.strategy === 'semantic'
      ? await findEntries(ctx, api, strategy, limit, filter)
      : await api.list({ ...ctx, limit, filter })

  return entries.length ? [args.heading, ...entries.map((entry) => `- ${entry.content}`)].join('\n') : ''
}

/**
 * Apply block-level and memory-level budgets to rendered block text.
 *
 * Blocks are considered in priority order. A block budget trims that block's
 * body before the memory budget chooses which sections remain visible.
 */
export function renderBudgetedMemoryBlocks(
  blocks: readonly RenderedMemoryBlock[],
  budget?: MemoryBudget,
): string {
  return renderBudgetedMemoryBlocksWithDecision(blocks, budget).text
}

/**
 * Apply block-level and memory-level budgets and return structured selection metadata.
 *
 * The plain `renderBudgetedMemoryBlocks()` wrapper preserves the existing public
 * behavior, while this deeper helper gives observability/devtools a stable
 * contract for explaining why lower-priority memory disappeared.
 */
export function renderBudgetedMemoryBlocksWithDecision(
  blocks: readonly RenderedMemoryBlock[],
  budget?: MemoryBudget,
): RenderedBudgetedMemory {
  const candidateBlocks = blocks.map(({ block }) => block.id)
  const trimmedBlocks: string[] = []
  const droppedBlocks: string[] = []
  const candidates = blocks.flatMap((candidate) => {
    const trimmed = trimToBudget(candidate.text, candidate.block.budget?.maxTokens)
    if (trimmed !== candidate.text) trimmedBlocks.push(candidate.block.id)
    if (!trimmed) {
      droppedBlocks.push(candidate.block.id)
      return []
    }
    return [{ ...candidate, text: trimmed }]
  })

  if (budget?.maxTokens === undefined || !Number.isFinite(budget.maxTokens)) {
    const text = formatMemorySections(candidates)
    return {
      text,
      budgetDecision: budgetDecisionIfNeeded(blocks, budget, {
        usedTokens: countTokens(text),
        candidateBlocks,
        includedBlocks: candidates.map(({ block }) => block.id),
        trimmedBlocks,
        droppedBlocks,
      }),
    }
  }

  if (budget.maxTokens <= 0) {
    return {
      text: '',
      budgetDecision: budgetDecision({
        maxTokens: budget.maxTokens,
        usedTokens: 0,
        candidateBlocks,
        includedBlocks: [],
        trimmedBlocks,
        droppedBlocks: unique([...droppedBlocks, ...candidates.map(({ block }) => block.id)]),
      }),
    }
  }

  const included: RenderedMemoryBlock[] = []
  let stoppedAt = candidates.length
  for (const [index, candidate] of candidates.entries()) {
    const next = [...included, candidate]
    if (countTokens(formatMemorySections(next)) <= budget.maxTokens) {
      included.push(candidate)
      continue
    }

    const trimmedText = trimSectionToRemainingBudget(candidate, included, budget.maxTokens)
    if (trimmedText) {
      trimmedBlocks.push(candidate.block.id)
      included.push({ ...candidate, text: trimmedText })
    }
    stoppedAt = index
    break
  }

  const includedIds = included.map(({ block }) => block.id)
  const droppedIds = unique([
    ...droppedBlocks,
    ...candidates.slice(stoppedAt).map(({ block }) => block.id).filter((blockId) => !includedIds.includes(blockId)),
  ])
  const text = formatMemorySections(included)
  return {
    text,
    budgetDecision: budgetDecision({
      maxTokens: budget.maxTokens,
      usedTokens: countTokens(text),
      candidateBlocks,
      includedBlocks: includedIds,
      trimmedBlocks,
      droppedBlocks: droppedIds,
    }),
  }
}

function budgetDecisionIfNeeded(
  blocks: readonly RenderedMemoryBlock[],
  budget: MemoryBudget | undefined,
  decision: Omit<MemoryRenderBudgetDecision, 'maxTokens'>,
): MemoryRenderBudgetDecision | undefined {
  const hasBlockBudget = blocks.some(({ block }) => block.budget?.maxTokens !== undefined)
  if (!hasBlockBudget && budget?.maxTokens === undefined) return undefined
  return budgetDecision({ ...decision, maxTokens: budget?.maxTokens })
}

function budgetDecision(decision: MemoryRenderBudgetDecision): MemoryRenderBudgetDecision {
  return {
    ...decision,
    trimmedBlocks: unique(decision.trimmedBlocks),
    droppedBlocks: unique(decision.droppedBlocks),
  }
}

function trimSectionToRemainingBudget(
  candidate: RenderedMemoryBlock,
  included: readonly RenderedMemoryBlock[],
  maxTokens: number,
): string {
  let low = 0
  let high = candidate.text.length
  let best = ''

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const text = candidate.text.slice(0, middle).trimEnd()
    const next = [...included, { ...candidate, text }]
    if (text && countTokens(formatMemorySections(next)) <= maxTokens) {
      best = text
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return best
}

function trimToBudget(text: string, maxTokens: number | undefined): string {
  if (maxTokens === undefined || !Number.isFinite(maxTokens)) return text
  if (maxTokens <= 0) return ''
  if (countTokens(text) <= maxTokens) return text

  let low = 0
  let high = text.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = text.slice(0, middle).trimEnd()
    if (candidate && countTokens(candidate) <= maxTokens) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

function formatMemorySections(blocks: readonly RenderedMemoryBlock[]): string {
  return blocks.map(({ block, text }) => `## Memory: ${block.id}\n${text}`).join('\n\n')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

async function findEntries(
  ctx: MemoryBlockContext,
  api: MemoryEntryRenderApi,
  strategy: MemorySemanticRenderStrategy,
  limit: number,
  filter: Record<string, unknown> | undefined,
): Promise<MemoryEntryApi[]> {
  const query = await resolveRenderQuery(strategy.query, ctx)
  if (!api.find) return api.list({ ...ctx, limit, filter })
  return api.find(query, { ...ctx, limit, filter })
}

async function resolveRenderQuery(query: MemoryRenderQuery, ctx: MemoryBlockContext): Promise<string> {
  return typeof query === 'function' ? query(ctx) : query
}
