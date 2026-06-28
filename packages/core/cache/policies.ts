/**
 * Semantic cache policies and the missing-plugin warning.
 *
 * {@link semanticCachePolicies} is a set of composable lookup/cache decision
 * helpers. {@link warnMissingSemanticCachePlugin} warns (once per prompt, dev
 * only) when a prompt declares semantic caching but no plugin is installed.
 * {@link shouldLookup} / {@link shouldCache} apply the configured (or default)
 * gates for a call.
 *
 * @module
 */

import type {
  SemanticCacheConfig,
  SemanticCacheLookupContext,
  SemanticCacheWriteContext,
} from './types'

const warnedPrompts = new Set<string>()

/** Composable lookup/cache decision policies for {@link SemanticCacheConfig}. */
export const semanticCachePolicies = {
  finishReason:
    (...allowed: string[]) =>
    (ctx: SemanticCacheWriteContext) =>
      ctx.finishReason === undefined || allowed.includes(ctx.finishReason),
  noErrors: () => (ctx: SemanticCacheWriteContext) => ctx.error === undefined,
  promptIds: (ids: readonly string[]) => (ctx: SemanticCacheLookupContext | SemanticCacheWriteContext) =>
    ctx.promptId !== undefined && ids.includes(ctx.promptId),
  skipWhenToolsPresent: () => (ctx: SemanticCacheLookupContext) => !ctx.toolsPresent,
  skipWhenToolCallsPresent: () => (ctx: SemanticCacheWriteContext) => !ctx.toolCallsPresent,
  all:
    <T>(policies: Array<(ctx: T) => boolean | Promise<boolean>>) =>
    async (ctx: T) => {
      for (const policy of policies) {
        if (!(await policy(ctx))) return false
      }
      return true
    },
  any:
    <T>(policies: Array<(ctx: T) => boolean | Promise<boolean>>) =>
    async (ctx: T) => {
      for (const policy of policies) {
        if (await policy(ctx)) return true
      }
      return false
    },
  not:
    <T>(policy: (ctx: T) => boolean | Promise<boolean>) =>
    async (ctx: T) =>
      !(await policy(ctx)),
  defaultShouldLookup: () => () => true,
  defaultShouldCache: () => semanticCachePolicies.finishReason('stop'),
}

/**
 * Warn (once per prompt, outside production) that a prompt requests semantic
 * caching but no {@link createSemanticCache} plugin is installed.
 *
 * @param promptId - The prompt id, or undefined for anonymous prompts.
 */
export function warnMissingSemanticCachePlugin(promptId: string | undefined): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return
  const key = promptId ?? '<anonymous>'
  if (warnedPrompts.has(key)) return
  warnedPrompts.add(key)
  console.warn(`Crux semantic cache is configured on prompt "${key}" but no createSemanticCache() plugin is installed.`)
}

/** Apply the configured (or default-true) lookup gate for a call. */
export async function shouldLookup(config: SemanticCacheConfig, ctx: SemanticCacheLookupContext): Promise<boolean> {
  return config.shouldLookup ? config.shouldLookup(ctx) : true
}

/** Apply the configured (or default finishReason==='stop') cache gate for a call. */
export async function shouldCache(config: SemanticCacheConfig, ctx: SemanticCacheWriteContext): Promise<boolean> {
  return config.shouldCache ? config.shouldCache(ctx) : semanticCachePolicies.defaultShouldCache()(ctx)
}
