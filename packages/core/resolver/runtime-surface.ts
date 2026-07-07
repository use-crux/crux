/**
 * Collectors for runtime surfaces contributed during prompt resolution.
 *
 * These helpers gather tools, constraints, and guardrails after the resolver
 * driver has selected the active contexts. Keeping collection in one place
 * makes collision behavior and merge order easier to audit.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyToolSet } from '../types'
import type { BlackboardEntry, Context } from '../prompt/context-types'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { ApprovalDeclaration } from '../tools/approval-policy'
import { createToolMergeAccumulator, type ToolMergeAccumulator, type ToolOwnerLabel } from './tool-merge'

export function contextToolOwner(ctx: Context<z.ZodType>, index: number): ToolOwnerLabel {
  return ctx.id ? `context:${ctx.id}` : `context[${index}]`
}

/** Convert one context's approval map into scoped declarations. */
function contextApprovalDeclarations(
  ctx: Context<z.ZodType>,
  owner: ToolOwnerLabel,
  toolNames: readonly string[],
): ApprovalDeclaration[] {
  if (!ctx.toolApproval) return []

  const owned = new Set(toolNames)
  const declarations: ApprovalDeclaration[] = []
  for (const [key, policy] of Object.entries(ctx.toolApproval)) {
    if (key !== '*' && !owned.has(key)) {
      const available = toolNames.length > 0 ? toolNames.map((name) => `"${name}"`).join(', ') : 'no tools'
      throw new Error(`${owner} declared toolApproval for "${key}", but it only owns ${available}.`)
    }
    declarations.push({
      layer: 'context',
      owner,
      key,
      policy,
      appliesTo: key === '*' ? [...toolNames] : [key],
    })
  }
  return declarations
}

/** Merge tools from active contexts in context order. */
export function mergeActiveContextTools(
  merge: ToolMergeAccumulator,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
): void {
  mergeActiveContextToolSurfaces(merge, contexts, input)
}

/** Merge context tools and collect their scoped approval declarations. */
export function mergeActiveContextToolSurfaces(
  merge: ToolMergeAccumulator,
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
): ApprovalDeclaration[] {
  const declarations: ApprovalDeclaration[] = []
  for (let index = 0; index < contexts.length; index++) {
    const ctx = contexts[index]!
    const owner = contextToolOwner(ctx, index)
    const tools = ctx.toolsFn?.(input)
    declarations.push(...contextApprovalDeclarations(ctx, owner, tools ? Object.keys(tools) : []))
    if (ctx.toolsFn) {
      merge.merge(tools, owner)
    }
  }
  return declarations
}

/** Collect tools from active contexts in context order. */
export function collectActiveContextTools(
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
): AnyToolSet {
  const merge = createToolMergeAccumulator()
  mergeActiveContextTools(merge, contexts, input)
  return merge.tools
}

/** Merge blackboard tools in blackboard entry order. */
export function mergeBlackboardTools(merge: ToolMergeAccumulator, blackboards: readonly BlackboardEntry[]): void {
  for (const board of blackboards) {
    merge.merge(board.asTools(), `blackboard:${board.id}`)
  }
}

/** Collect blackboard tools and reject collisions within blackboard entries. */
export function collectBlackboardTools(blackboards: readonly BlackboardEntry[]): AnyToolSet {
  const merge = createToolMergeAccumulator()
  mergeBlackboardTools(merge, blackboards)
  return merge.tools
}

/** Collect semantic constraints from active contexts. */
export function collectContextConstraints(contexts: readonly Context<z.ZodType>[]): Constraint[] {
  const result: Constraint[] = []
  for (const ctx of contexts) {
    if (ctx.constraints && ctx.constraints.length > 0) {
      result.push(...ctx.constraints)
    }
  }
  return result
}

/** Collect guardrails from active contexts. */
export function collectContextGuardrails(contexts: readonly Context<z.ZodType>[]): Guardrail[] {
  const result: Guardrail[] = []
  for (const ctx of contexts) {
    if (ctx.guardrails && ctx.guardrails.length > 0) {
      result.push(...ctx.guardrails)
    }
  }
  return result
}
