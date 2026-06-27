/**
 * Pure system-block planning for Google CachedContent.
 *
 * Google requires cached content to be a stable leading prefix of the system
 * prompt. This module finds that prefix (leading `providerCache` blocks) and
 * reconstructs the uncached suffix that must travel inline with the request.
 * It performs no I/O and no cache decisions — the lifecycle owns those.
 *
 * @module
 */

import type { SystemBlock } from '@crux/core'

/** Decomposition of resolved system blocks into a cacheable prefix and suffix. */
export interface SystemBlockPlan {
  /** Leading run of `providerCache` blocks eligible for a CachedContent object. */
  readonly cacheablePrefix: readonly SystemBlock[]
  /** Uncached suffix text to send inline as `systemInstruction`, if any. */
  readonly uncachedInstruction: string | undefined
}

/** Inputs needed to decompose a request's system prompt. */
export interface PlanSystemBlocksArgs {
  /** Structured system blocks carrying provider-neutral cache hints. */
  readonly systemBlocks?: readonly SystemBlock[]
  /** Flat fallback system instruction from the resolved prompt. */
  readonly system?: string
}

/**
 * Split resolved system blocks into a cacheable prefix and an inline suffix.
 *
 * When the leading blocks are cacheable, the suffix is reconstructed from the
 * remaining blocks. When no leading block is cacheable, the prefix is empty and
 * the flat `system` string is used verbatim as the inline instruction.
 */
export function planSystemBlocks(args: PlanSystemBlocksArgs): SystemBlockPlan {
  const cacheablePrefix = cacheableSystemPrefix(args.systemBlocks)
  if (cacheablePrefix.length === 0) {
    return { cacheablePrefix, uncachedInstruction: args.system }
  }

  const uncachedBlocks = args.systemBlocks?.slice(cacheablePrefix.length) ?? []
  return { cacheablePrefix, uncachedInstruction: joinSystemBlocks(uncachedBlocks) }
}

/** Join system-block texts with the canonical `\n\n` separator. */
export function joinSystemBlocks(blocks: readonly SystemBlock[]): string | undefined {
  if (blocks.length === 0) return undefined
  const text = blocks.map((block) => block.text).join('\n\n')
  return text.length > 0 ? text : undefined
}

/** Collect the leading run of `providerCache` blocks. */
function cacheableSystemPrefix(blocks: readonly SystemBlock[] | undefined): readonly SystemBlock[] {
  if (!blocks) return []

  const prefix: SystemBlock[] = []
  for (const block of blocks) {
    if (!block.providerCache) break
    prefix.push(block)
  }
  return prefix
}
