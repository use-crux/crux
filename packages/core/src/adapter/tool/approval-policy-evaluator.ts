/**
 * Internal approval-policy evaluator for tool lifecycle sessions.
 *
 * The public contract declares approval requirements at composition sites
 * (`context()`, `prompt()`, and per-call options). This module turns those
 * declarations, plus legacy-compatible `approvalMiddleware()` metadata, into
 * one backend-neutral boolean for a concrete tool call.
 *
 * @module
 */

import type { Message } from '../../generation/messages'
import {
  approvalPolicyKind,
  resolveApprovalPolicy,
  type ApprovalDeclaration,
  type ToolApprovalContext,
  type ToolApprovalMap,
} from '../../tools/approval-policy'
import { evaluateApprovalMiddlewareRequest } from '../../tools/middleware'
import type { ToolApprovalPolicyIdentity } from '../../tools/types'

/** The call shape needed to evaluate approval requirements. */
export interface ApprovalPolicyToolCall {
  /** Provider-owned tool call id. */
  readonly id: string
  /** Resolved tool name. */
  readonly name: string
  /** Raw provider input for the tool. */
  readonly args: unknown
}

/** Trace payload emitted when a declared approval policy is evaluated. */
export interface ApprovalPolicyTrace {
  readonly toolCallId: string
  readonly toolName: string
  readonly policy: 'always' | 'never' | 'function'
  readonly result: 'approve' | 'suspend'
  readonly layer?: 'call' | 'prompt' | 'context'
  readonly key?: string
  readonly owner?: string
}

/** Options for {@link requiresToolApproval}. */
export interface RequiresToolApprovalOptions {
  /** The middleware-wrapped tool object, if one exists for the call. */
  readonly tool: unknown
  /** The concrete tool call being gated. */
  readonly toolCall: ApprovalPolicyToolCall
  /** Current conversation history. */
  readonly messages: readonly Message[]
  /** Shared caller-provided context for this generation run. */
  readonly runtimeContext?: unknown
  /** Parsed context value for this tool when it declares `contextSchema`. */
  readonly toolContext?: unknown
  /** Ordered approval declarations collected from context, prompt, and call sites. */
  readonly declarations: readonly ApprovalDeclaration[]
  /** Optional policy trace sink used by dialect parity tests. */
  readonly onPolicyTrace?: (trace: ApprovalPolicyTrace) => void
  /** Whether request lifecycle callbacks should run for this evaluation. */
  readonly notifyRequest?: boolean
}

/** Approval verdict plus optional evidence callback for the request span. */
export interface ToolApprovalRequirement {
  readonly requiresApproval: boolean
  readonly policies: readonly ToolApprovalPolicyIdentity[]
  readonly observeRequest?: () => void
}

/**
 * Convert per-call `toolApproval` options into the same declaration shape
 * used by resolved context and prompt declarations.
 */
export function callApprovalDeclarations(map: ToolApprovalMap | undefined): ApprovalDeclaration[] {
  if (!map) return []
  return Object.entries(map).map(([key, policy]) => ({
    layer: 'call' as const,
    key,
    policy,
  }))
}

/**
 * Evaluate whether a tool call requires approval.
 *
 * Declared policies are exact-name/wildcard aware through
 * {@link resolveApprovalPolicy}. Middleware metadata is evaluated second and
 * OR'd with declarations so existing `approvalMiddleware()` users retain the
 * ability to request approval without mutating the tool object.
 */
export async function requiresToolApproval(options: RequiresToolApprovalOptions): Promise<ToolApprovalRequirement> {
  const { tool, toolCall, messages, declarations } = options
  if (!tool || typeof tool !== 'object') return { requiresApproval: false, policies: [] }

  const declaration = await evaluateDeclaredApprovalPolicy(toolCall, messages, declarations, options)
  const middlewareOptions = {
    toolCallId: toolCall.id,
    messages,
    runtimeContext: options.runtimeContext,
    ...(options.toolContext !== undefined ? { context: options.toolContext } : {}),
  }
  const middleware = await evaluateApprovalMiddlewareRequest(
    tool,
    {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      input: toolCall.args,
      options: middlewareOptions,
      ...(options.toolContext !== undefined ? { context: options.toolContext } : {}),
      runtimeContext: options.runtimeContext,
      messages,
    },
    { notifyRequest: options.notifyRequest },
  )
  return {
    requiresApproval: declaration.requiresApproval || middleware.requiresApproval,
    policies: [...(declaration.identity ? [declaration.identity] : []), ...middleware.policies],
    ...(middleware.observeRequest ? { observeRequest: middleware.observeRequest } : {}),
  }
}

async function evaluateDeclaredApprovalPolicy(
  toolCall: ApprovalPolicyToolCall,
  messages: readonly Message[],
  declarations: readonly ApprovalDeclaration[],
  options: Pick<RequiresToolApprovalOptions, 'onPolicyTrace' | 'runtimeContext'>,
): Promise<{
  readonly requiresApproval: boolean
  readonly identity?: ToolApprovalPolicyIdentity
}> {
  const resolvedPolicy = resolveApprovalPolicy(toolCall.name, declarations)
  if (!resolvedPolicy) return { requiresApproval: false }

  const { policy, provenance } = resolvedPolicy
  let requiresApproval: boolean
  if (policy === 'always') {
    requiresApproval = true
  } else if (policy === 'never') {
    requiresApproval = false
  } else {
    const context: ToolApprovalContext = {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      input: toolCall.args,
      runtimeContext: options.runtimeContext,
      messages,
    }
    try {
      requiresApproval = Boolean(await policy(context))
    } catch {
      requiresApproval = true
    }
  }

  options.onPolicyTrace?.({
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    policy: approvalPolicyKind(policy),
    result: requiresApproval ? 'suspend' : 'approve',
    layer: provenance.layer,
    key: provenance.key,
    ...(provenance.owner ? { owner: provenance.owner } : {}),
  })
  return {
    requiresApproval,
    ...(requiresApproval
      ? {
          identity: {
            kind: 'declaration' as const,
            layer: provenance.layer,
            key: provenance.key,
            policyKind: approvalPolicyKind(policy) as 'always' | 'function',
            ...(provenance.owner ? { owner: provenance.owner } : {}),
          },
        }
      : {}),
  }
}
