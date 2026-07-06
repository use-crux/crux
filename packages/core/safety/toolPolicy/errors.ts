/**
 * Policy-terminal errors for Safety-owned tool policies.
 *
 * @module
 */

import type { SafetyDecision } from '../decision'
import { POLICY_TERMINAL, type PolicyTerminalError } from '../errors'

/** Error thrown when a Safety tool policy blocks a tool call or result. */
export class ToolPolicyBlockedError extends Error implements PolicyTerminalError {
  readonly [POLICY_TERMINAL] = true
  readonly policyId: string
  readonly decisions: readonly SafetyDecision[]

  constructor(init: {
    readonly policyId: string
    readonly reason: string
    readonly decisions?: readonly SafetyDecision[]
  }) {
    super(init.reason)
    this.name = 'ToolPolicyBlockedError'
    this.policyId = init.policyId
    this.decisions = init.decisions ?? []
  }
}
