/**
 * Public configuration types for Safety-owned tool policies.
 *
 * `toolPolicy()` is the declarative safety surface for tool approval,
 * argument screening, and result screening. Low-level `toolMiddleware`
 * remains available for execution plumbing.
 *
 * @module
 */

import type { ToolMatcher } from '../../tools/types'
import type { GuardrailRun } from '../guardrail/types'
import type { BoundaryDef } from '../boundary'

/** Internal raw tool-call payload used by `toolPolicy.args()`. */
export interface ToolCallSubject {
  readonly toolCallId?: string
  readonly toolName: string
  readonly input: unknown
}

/** Internal raw tool-result payload used by `toolPolicy.result()`. */
export interface ToolResultSubject {
  readonly toolCallId?: string
  readonly toolName: string
  readonly input?: unknown
  readonly output: unknown
}

export type ToolCallBoundary = BoundaryDef<'tool.call', ToolCallSubject>
export type ToolResultBoundary = BoundaryDef<'tool.result', ToolResultSubject>

export type ToolPolicyAction = 'allow' | 'block' | 'requestApproval' | 'report'

export type ToolPolicyMatch =
  | ToolMatcher
  | { readonly tool: string | RegExp }
  | readonly ToolMatcher[]

export interface ToolPolicyConfig {
  /** Stable policy id used in traces and middleware identity. */
  readonly id: string
  /** Tool matcher. Omit to apply to every tool. */
  readonly match?: ToolPolicyMatch
  /** Decision for matched tool calls. */
  readonly action: ToolPolicyAction
  /** Reason used for blocked or approval-requested tools. */
  readonly reason?: string
}

export interface ToolPolicyApprovalOptions {
  /** Stable policy id used in middleware identity and Safety decisions. */
  readonly id: string
  /** Tool matcher. Omit to apply to every tool. */
  readonly match?: ToolPolicyMatch
  /** Optional human-facing reason for requesting approval. */
  readonly reason?: string
}

export interface ToolPolicyArgsOptions {
  /** Stable policy id used in middleware identity and Safety decisions. */
  readonly id: string
  /** Tool matcher. Omit to apply to every tool. */
  readonly match?: ToolPolicyMatch
  /** Guardrail strategy run over the `tool.call` boundary subject. */
  readonly run: GuardrailRun<ToolCallBoundary>
}

export interface ToolPolicyResultOptions {
  /** Stable policy id used in middleware identity and Safety decisions. */
  readonly id: string
  /** Tool matcher. Omit to apply to every tool. */
  readonly match?: ToolPolicyMatch
  /** Guardrail strategy run over the `tool.result` boundary subject. */
  readonly run: GuardrailRun<ToolResultBoundary>
}
