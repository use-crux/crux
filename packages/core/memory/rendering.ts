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
  const candidates = blocks
    .map((candidate) => ({
      ...candidate,
      text: trimToBudget(candidate.text, candidate.block.budget?.maxTokens),
    }))
    .filter((candidate) => candidate.text.length > 0)

  if (budget?.maxTokens === undefined || !Number.isFinite(budget.maxTokens)) {
    return formatMemorySections(candidates)
  }

  if (budget.maxTokens <= 0) return ''

  const included: RenderedMemoryBlock[] = []
  for (const candidate of candidates) {
    const next = [...included, candidate]
    if (countTokens(formatMemorySections(next)) <= budget.maxTokens) {
      included.push(candidate)
      continue
    }

    const trimmedText = trimSectionToRemainingBudget(candidate, included, budget.maxTokens)
    if (trimmedText) included.push({ ...candidate, text: trimmedText })
    break
  }

  return formatMemorySections(included)
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
