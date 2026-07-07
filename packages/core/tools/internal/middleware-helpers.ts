/**
 * Stateless helpers shared by the tool middleware factories.
 *
 * These are pure utilities (matching, predicate evaluation, id/key generation)
 * with no module-level state — that state lives in `../middleware` so a single
 * process shares one approval registry. Not part of the public package surface.
 *
 * @module
 */

import type { ToolCallContext, ToolLike, ToolMatcher } from '../types'

/** Structural guard: any non-null object is treated as a wrappable tool. */
export function isToolLike(value: unknown): value is ToolLike {
  return value !== null && typeof value === 'object'
}

/** Return true when any matcher selects the given tool call. */
export async function matchesAny<TInput>(
  matchers: readonly ToolMatcher<TInput>[],
  call: ToolCallContext<TInput>,
): Promise<boolean> {
  for (const matcher of matchers) {
    if (typeof matcher === 'string' && matcher === call.toolName) return true
    if (matcher instanceof RegExp && matcher.test(call.toolName)) return true
    if (typeof matcher === 'function' && (await matcher(call))) return true
  }
  return false
}

/** Throw a consistent error when a middleware id is empty. */
export function assertNonEmptyId(id: string, name: string): void {
  if (!id.trim()) throw new Error(`${name}() requires a non-empty id.`)
}

/** Generate a synthetic tool-call id for calls that arrive without one. */
export function createToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Build the dedupe key used to fire each approval decision at most once. */
export function approvalDecisionKey(approvalId: string, status: 'approved' | 'denied'): string {
  return `approval:${approvalId}:${status}`
}
