/**
 * System message composition for the prompt compiler.
 *
 * This module turns prompt-owned system text and active context contributions
 * into the final system string, inspect parts, provider-cache blocks, and
 * token-budget artifacts. It is deliberately below `compilePrompt()` so the
 * public compiler boundary can stay small while this lower layer owns the
 * ordering and budget rules.
 *
 * @module
 */

import { z } from 'zod'
import type { Context } from '../prompt/context-types'
import type { DroppedContext, InspectPart, SystemBlock } from './types'
import type { CruxArtifactId, CruxContextContributionPreview } from '../observability/contract'
import { countTokens } from '../shared/tokenizer'
import type { ResolvedSystemContent } from './contract'
import { contextContributionKind, contextInjectedToolNames, contextInjects } from './lower'
import type { ResolverPorts } from './ports'
import { emitBudgetArtifact, includeByBudget, type BudgetContextPart } from './system-budget'
import { inputForSourceKeys, normalizeSystemContent } from './system-content'

/** Result returned by {@link buildSystemMessage}. */
export interface BuiltSystemMessage {
  system: string
  parts: InspectPart[]
  droppedContexts: DroppedContext[]
  blocks: SystemBlock[]
  promptBudgetArtifactId?: CruxArtifactId
}

/** Internal representation of a resolved context contribution. */
interface ResolvedContextPart extends BudgetContextPart {
  providerCache: boolean
  artifactId?: CruxArtifactId
}

/**
 * Compute a stable context-cache key from context id and relevant input fields.
 *
 * Only keys declared in the context's input schema participate; storage and
 * expiry remain behind the `ContextCachePort`.
 */
function computeCacheKey(contextId: string, input: Record<string, unknown>, inputKeys: readonly string[]): string {
  if (inputKeys.length === 0) {
    return `cache:ctx:${contextId}:`
  }
  const relevant: Record<string, unknown> = {}
  const sortedKeys = [...inputKeys].sort()
  for (const key of sortedKeys) {
    relevant[key] = input[key]
  }
  return `cache:ctx:${contextId}:${JSON.stringify(relevant)}`
}

/** Compose prompt and context system text into final call-ready structures. */
export async function buildSystemMessage(
  ownSystem: string | ResolvedSystemContent,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
  tokenBudget: number | undefined,
  ports: ResolverPorts,
): Promise<BuiltSystemMessage> {
  const parts: InspectPart[] = []
  const droppedContexts: DroppedContext[] = []
  let promptBudgetArtifactId: CruxArtifactId | undefined

  const ownContent = typeof ownSystem === 'string' ? normalizeSystemContent(ownSystem, false) : ownSystem
  const ownTokens = ownContent.text ? countTokens(ownContent.text) : 0
  parts.push({
    source: 'prompt',
    text: ownContent.text,
    tokens: ownTokens,
    skipped: !ownContent.text,
    ...(ownContent.segments ? { segments: ownContent.segments } : {}),
    ...(ownContent.staticTokens !== undefined ? { staticTokens: ownContent.staticTokens } : {}),
    ...(ownContent.dynamicTokens !== undefined ? { dynamicTokens: ownContent.dynamicTokens } : {}),
  })

  const resolved: ResolvedContextPart[] = []
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i]
    const source = ctx.id ? `context:${ctx.id}` : `context[${i}]`

    let contextArtifactId: CruxArtifactId | undefined
    let injectedTools: readonly string[] | undefined
    const text = await ports.observability.scope(
      {
        name: ctx.id ?? `context[${i}]`,
        family: 'context',
        primitive: 'context.resolve',
        attributes: {
          contextId: ctx.id,
          source,
          priority: ctx.priority,
          cacheTtl: ctx.cacheTtl,
          providerCache: ctx.providerCache,
        },
      },
      async () => {
        let resolvedContent: ResolvedSystemContent
        let cacheStatus: 'hit' | 'miss' | 'disabled' = 'disabled'
        const contextInferenceInput = inputForSourceKeys(input, ctx.inputKeys)
        if (ctx.cacheTtl > 0 && ctx.id) {
          const cacheKey = computeCacheKey(ctx.id, input, ctx.inputKeys)
          const cached = ports.cache.get(cacheKey)
          if (cached !== null) {
            resolvedContent = cached.content
            cacheStatus = 'hit'
            ports.instrumentation.contextCacheHit({
              contextId: ctx.id,
              cacheKey,
              ageMs: cached.ageMs,
            })
          } else {
            const start = ports.clock.now()
            resolvedContent = normalizeSystemContent(
              await ctx.systemFn(input),
              ctx.systemKind !== 'static',
              `Context "${source}" system function`,
              contextInferenceInput,
            )
            cacheStatus = 'miss'
            const resolutionMs = ports.clock.now() - start
            if (resolvedContent.text) {
              ports.cache.set(cacheKey, resolvedContent, ctx.cacheTtl)
            }
            ports.instrumentation.contextCacheMiss({
              contextId: ctx.id,
              cacheKey,
              resolutionMs,
            })
          }
        } else {
          resolvedContent = normalizeSystemContent(
            await ctx.systemFn(input),
            ctx.systemKind !== 'static',
            `Context "${source}" system function`,
            contextInferenceInput,
          )
        }

        if (resolvedContent.text) {
          const tokens = countTokens(resolvedContent.text)
          injectedTools = contextInjectedToolNames(ctx, input)
          const preview = {
            kind: 'context.contribution',
            state: 'active',
            included: true,
            sourceId: source,
            injectableKind: contextContributionKind(ctx),
            injects: contextInjects(ctx),
            injectedTools,
            priority: ctx.priority,
            sizeBytes: resolvedContent.text.length,
            tokens,
            cacheStatus,
            ...(resolvedContent.segments ? { segments: resolvedContent.segments } : {}),
            ...(resolvedContent.staticTokens !== undefined ? { staticTokens: resolvedContent.staticTokens } : {}),
            ...(resolvedContent.dynamicTokens !== undefined ? { dynamicTokens: resolvedContent.dynamicTokens } : {}),
            text: resolvedContent.text,
          } satisfies CruxContextContributionPreview
          contextArtifactId = ports.observability.artifact(
            {
              kind: 'context.contribution',
              contentType: 'application/json',
              encoding: 'json',
              sizeBytes: resolvedContent.text.length,
              preview,
              attributes: {
                contextId: ctx.id,
                source,
                tokens,
                cacheStatus,
              },
            },
            { source },
          )
        }

        return resolvedContent
      },
    )

    if (!text.text) {
      parts.push({ source, text: '', tokens: 0, skipped: true })
      continue
    }

    const tokens = countTokens(text.text)
    resolved.push({
      source,
      injectableKind: contextContributionKind(ctx),
      text: text.text,
      tokens,
      priority: ctx.priority,
      index: i,
      providerCache: ctx.providerCache,
      ...(injectedTools ? { injectedTools } : {}),
      ...(text.segments ? { segments: text.segments } : {}),
      ...(text.staticTokens !== undefined ? { staticTokens: text.staticTokens } : {}),
      ...(text.dynamicTokens !== undefined ? { dynamicTokens: text.dynamicTokens } : {}),
      ...(contextArtifactId ? { artifactId: contextArtifactId } : {}),
    })
  }

  includeByBudget({ parts, resolved, droppedContexts, tokenBudget, ownContent, ownTokens })
  promptBudgetArtifactId = emitBudgetArtifact({ parts, droppedContexts, tokenBudget, ports })

  const system = parts
    .filter((part) => !part.skipped && part.text)
    .map((part) => part.text)
    .join('\n\n')

  assertNoObjectInterpolation(system, parts)

  const blocks = parts.flatMap((part): SystemBlock[] => {
    if (part.skipped || !part.text) return []
    const resolvedPart = resolved.find((r) => r.source === part.source)
    return [
      {
        source: part.source,
        text: part.text,
        providerCache: resolvedPart?.providerCache ?? false,
        ...(resolvedPart?.artifactId ? { artifactId: resolvedPart.artifactId } : {}),
        ...(part.segments ? { segments: part.segments } : {}),
        ...(part.staticTokens !== undefined ? { staticTokens: part.staticTokens } : {}),
        ...(part.dynamicTokens !== undefined ? { dynamicTokens: part.dynamicTokens } : {}),
      },
    ]
  })

  return {
    system,
    parts,
    droppedContexts,
    blocks,
    ...(promptBudgetArtifactId ? { promptBudgetArtifactId } : {}),
  }
}

function assertNoObjectInterpolation(system: string, parts: readonly InspectPart[]): void {
  if (!system.includes('[object Object]')) return
  const culprit = parts.find((part) => part.text.includes('[object Object]'))
  throw new Error(
    `Assembled system message contains "[object Object]" - an object was interpolated ` +
      `into a string instead of being serialized. ` +
      (culprit ? `Source: ${culprit.source}. ` : '') +
      `Check your system/prompt functions for unserialised objects (use JSON.stringify() or String()).`,
  )
}
