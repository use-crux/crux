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

/** Collect tools from active contexts in context order. */
export function collectActiveContextTools(
  contexts: readonly Context<z.ZodType>[],
  input: Record<string, unknown>,
): AnyToolSet {
  const tools: AnyToolSet = {}
  for (const ctx of contexts) {
    if (ctx.toolsFn) {
      Object.assign(tools, ctx.toolsFn(input))
    }
  }
  return tools
}

/** Collect blackboard tools and reject collisions with existing tool names. */
export function collectBlackboardTools(
  blackboards: readonly BlackboardEntry[],
  existingTools: AnyToolSet = {},
): AnyToolSet {
  const tools: AnyToolSet = {}
  const existingNames = new Set(Object.keys(existingTools))

  for (const board of blackboards) {
    const boardTools = board.asTools()
    for (const [name, tool] of Object.entries(boardTools)) {
      if (name in tools || existingNames.has(name)) {
        throw new Error(
          `Blackboard tool name collision for "${name}". ` +
            `Blackboard "${board.id}" generated a tool name that already exists. ` +
            `Configure a tool prefix, e.g. blackboard({ id: "${board.id}", ..., tools: { prefix: "${board.id}" } }).`,
        )
      }
      tools[name] = tool
    }
  }

  return tools
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
