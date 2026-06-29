/**
 * Token-budget selection for composed system messages.
 *
 * System composition resolves context text before budget selection. This module
 * decides which resolved context parts remain visible, records dropped context
 * facts, and emits the prompt-budget artifact.
 *
 * @module
 */

import type { ContextTextSegment } from '../prompt/context-types'
import type { DroppedContext, InspectPart } from './types'
import type {
  CruxArtifactId,
  CruxContextContributionPreview,
  CruxContextInjectableKind,
} from '../observability/contract'
import type { ResolvedSystemContent } from './contract'
import type { ResolverPorts } from './ports'
import { emitPromptBudgetArtifact } from './prompt-observability'

/** Resolved context shape required for token-budget decisions. */
export interface BudgetContextPart {
  source: string
  injectableKind: CruxContextInjectableKind
  text: string
  tokens: number
  priority: number
  index: number
  injectedTools?: readonly string[]
  segments?: readonly ContextTextSegment[]
  staticTokens?: number
  dynamicTokens?: number
}

/** Apply token-budget selection and append inspect parts in original order. */
export function includeByBudget(input: {
  parts: InspectPart[]
  resolved: BudgetContextPart[]
  droppedContexts: DroppedContext[]
  tokenBudget: number | undefined
  ownContent: ResolvedSystemContent
  ownTokens: number
}): void {
  const { parts, resolved, droppedContexts, tokenBudget, ownContent, ownTokens } = input
  if (tokenBudget === undefined) {
    for (const part of resolved) {
      parts.push(toInspectPart(part, false))
    }
    return
  }

  const separatorTokens = ownContent.text ? 1 : 0
  const sortedByPriority = [...resolved].sort((left, right) => left.priority - right.priority)
  const contextSeparators = resolved.length > 0 ? resolved.length - 1 + separatorTokens : 0
  let totalNeeded = resolved.reduce((sum, part) => sum + part.tokens, 0) + contextSeparators
  const remainingBudget = tokenBudget - ownTokens
  const droppedIndices = new Set<number>()

  if (totalNeeded > remainingBudget) {
    for (const part of sortedByPriority) {
      if (totalNeeded <= remainingBudget) break
      totalNeeded -= part.tokens + 1
      droppedIndices.add(part.index)
      droppedContexts.push(toDroppedContext(part))
    }
  }

  for (const part of resolved) {
    parts.push(toInspectPart(part, droppedIndices.has(part.index)))
  }
}

/** Emit prompt-budget observability when the caller supplied a token budget. */
export function emitBudgetArtifact(input: {
  parts: InspectPart[]
  droppedContexts: DroppedContext[]
  tokenBudget: number | undefined
  ports: ResolverPorts
}): CruxArtifactId | undefined {
  if (input.tokenBudget === undefined) return undefined
  const usedTokens = input.parts.reduce((sum, part) => (part.skipped ? sum : sum + part.tokens), 0)
  const dropped = input.droppedContexts.map(
    (ctx) =>
      ({
        kind: 'context.contribution',
        state: 'dropped-budget',
        included: false,
        sourceId: ctx.source,
        injectableKind: ctx.injectableKind ?? 'context',
        reason: 'token budget',
        priority: ctx.priority,
        sizeBytes: ctx.text.length,
        tokens: ctx.tokens,
        ...(ctx.injectedTools ? { injectedTools: ctx.injectedTools } : {}),
        ...(ctx.segments ? { segments: ctx.segments } : {}),
        ...(ctx.staticTokens !== undefined ? { staticTokens: ctx.staticTokens } : {}),
        ...(ctx.dynamicTokens !== undefined ? { dynamicTokens: ctx.dynamicTokens } : {}),
        text: ctx.text,
      }) satisfies CruxContextContributionPreview,
  )
  return emitPromptBudgetArtifact(input.ports, {
    kind: 'prompt.budget',
    usedTokens,
    totalTokens: input.tokenBudget,
    dropped,
  })
}

function toInspectPart(part: BudgetContextPart, skipped: boolean): InspectPart {
  return {
    source: part.source,
    text: part.text,
    tokens: part.tokens,
    skipped,
    ...(part.segments ? { segments: part.segments } : {}),
    ...(part.staticTokens !== undefined ? { staticTokens: part.staticTokens } : {}),
    ...(part.dynamicTokens !== undefined ? { dynamicTokens: part.dynamicTokens } : {}),
  }
}

function toDroppedContext(part: BudgetContextPart): DroppedContext {
  return {
    source: part.source,
    injectableKind: part.injectableKind,
    text: part.text,
    tokens: part.tokens,
    priority: part.priority,
    ...(part.injectedTools ? { injectedTools: part.injectedTools } : {}),
    ...(part.segments ? { segments: part.segments } : {}),
    ...(part.staticTokens !== undefined ? { staticTokens: part.staticTokens } : {}),
    ...(part.dynamicTokens !== undefined ? { dynamicTokens: part.dynamicTokens } : {}),
  }
}
