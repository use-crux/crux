/**
 * Safety-owned tool policy helpers.
 *
 * The helpers return ordinary `ToolMiddleware` so they fit the current adapter
 * protocol, while blocked decisions carry Safety-shaped evidence.
 *
 * @module
 */

import { approvalMiddleware, toolMiddleware } from '../../tools/middleware'
import type { ToolCallContext, ToolMatcher, ToolMiddleware, ToolMiddlewareNext } from '../../tools/types'
import { boundary } from '../boundary'
import type { SafetyDecision, SafetyFinding, SafetyRunContext } from '../decision'
import { safeCaptureSummary } from '../errors'
import { validateGuardrailRunResult } from '../guardrail/types'
import { ToolPolicyBlockedError } from './errors'
import type {
  ToolPolicyArgsOptions,
  ToolPolicyApprovalOptions,
  ToolPolicyConfig,
  ToolPolicyMatch,
  ToolPolicyResultOptions,
} from './types'

interface ToolPolicyFactory {
  (config: ToolPolicyConfig): ToolMiddleware
  readonly approval: (options: ToolPolicyApprovalOptions) => ToolMiddleware
  readonly args: (options: ToolPolicyArgsOptions) => ToolMiddleware
  readonly result: (options: ToolPolicyResultOptions) => ToolMiddleware
}

/** Create a Safety-owned tool policy mounted through the tool middleware seam. */
function defineToolPolicy(config: ToolPolicyConfig): ToolMiddleware {
  if (config.action === 'requestApproval') {
    return approvalMiddleware({
      id: config.id,
      match: normalizeMatch(config.match),
      onRequest: config.reason
        ? () => {
            // Approval request copy is carried by docs/devtools in Phase 5.
          }
        : undefined,
    })
  }

  return toolMiddleware({
    id: config.id,
    match: normalizeMatch(config.match),
    aroundExecute: async (call, next) => {
      if (config.action === 'block') {
        throw blockedToolPolicy({
          policyId: config.id,
          boundary: 'tool.call',
          reason: config.reason ?? `Tool "${call.toolName}" blocked by policy "${config.id}".`,
          subject: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          },
        })
      }
      return next(call.input, call.options)
    },
  })
}

function approval(options: ToolPolicyApprovalOptions): ToolMiddleware {
  return defineToolPolicy({
    id: options.id,
    match: options.match,
    action: 'requestApproval',
    reason: options.reason,
  })
}

function args(options: ToolPolicyArgsOptions): ToolMiddleware {
  return toolMiddleware({
    id: options.id,
    match: normalizeMatch(options.match),
    aroundExecute: async (call, next) => {
      const subject = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      }
      const findings: SafetyFinding[] = []
      const ctx = toolContext(options.id, boundary.tool.call(), call, findings)
      const result = validateGuardrailRunResult(await options.run(subject, ctx), {
        streaming: false,
        last: true,
        policyId: options.id,
        boundary: 'tool.call',
      })

      switch (result.action) {
        case 'allow':
        case 'warn':
          return next(call.input, call.options)
        case 'block':
          throw blockedToolPolicy({
            policyId: options.id,
            boundary: 'tool.call',
            reason: result.reason,
            subject,
            findings,
          })
        case 'rewrite':
          return next(readToolCallInput(result.value), call.options)
        case 'hold':
          throw new Error('Tool policy cannot hold tool calls.')
      }
    },
  })
}

function result(options: ToolPolicyResultOptions): ToolMiddleware {
  return toolMiddleware({
    id: options.id,
    match: normalizeMatch(options.match),
    aroundExecute: async (call, next) => {
      const output = await next(call.input, call.options)
      const subject = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        output,
      }
      const findings: SafetyFinding[] = []
      const ctx = toolContext(options.id, boundary.tool.result(), call, findings)
      const decision = validateGuardrailRunResult(await options.run(subject, ctx), {
        streaming: false,
        last: true,
        policyId: options.id,
        boundary: 'tool.result',
      })

      switch (decision.action) {
        case 'allow':
        case 'warn':
          return output
        case 'block':
          throw blockedToolPolicy({
            policyId: options.id,
            boundary: 'tool.result',
            reason: decision.reason,
            subject,
            findings,
          })
        case 'rewrite':
          return readToolResultOutput(decision.value)
        case 'hold':
          throw new Error('Tool policy cannot hold tool results.')
      }
    },
  })
}

function normalizeMatch(match: ToolPolicyMatch | undefined): readonly ToolMatcher[] {
  if (match === undefined) return [() => true]
  if (isToolMatcherArray(match)) return match
  if (typeof match === 'object' && !(match instanceof RegExp) && 'tool' in match) return [match.tool]
  return [match]
}

function isToolMatcherArray(match: ToolPolicyMatch): match is readonly ToolMatcher[] {
  return Array.isArray(match)
}

function toolContext<B extends ReturnType<typeof boundary.tool.call> | ReturnType<typeof boundary.tool.result>>(
  id: string,
  on: B,
  call: ToolCallContext,
  findings: SafetyFinding[] = [],
): SafetyRunContext<B> {
  return {
    policy: { id, mode: 'enforce' },
    boundary: { id: on.id as never, kind: on.id as never },
    prompt: {},
    model: {},
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: {
      add(finding) {
        findings.push(finding)
      },
    },
    tool: { name: call.toolName },
  }
}

function blockedToolPolicy(input: {
  readonly policyId: string
  readonly boundary: 'tool.call' | 'tool.result'
  readonly reason: string
  readonly subject: unknown
  readonly findings?: readonly SafetyFinding[]
}): ToolPolicyBlockedError {
  return new ToolPolicyBlockedError({
    policyId: input.policyId,
    reason: input.reason,
    decisions: [
      toolPolicyDecision({
        policyId: input.policyId,
        boundary: input.boundary,
        action: 'block',
        reason: input.reason,
        subject: input.subject,
        findings: input.findings,
      }),
    ],
  })
}

function toolPolicyDecision(input: {
  readonly policyId: string
  readonly boundary: 'tool.call' | 'tool.result' | 'approval.request'
  readonly action: Extract<SafetyDecision['action'], 'allow' | 'block' | 'warn' | 'rewrite' | 'request_approval'>
  readonly subject: unknown
  readonly reason?: string
  readonly findings?: readonly SafetyFinding[]
}): SafetyDecision {
  return {
    policyId: input.policyId,
    kind: 'toolPolicy',
    boundary: input.boundary,
    mode: 'enforce',
    action: input.action,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.findings && input.findings.length > 0 ? { findings: input.findings } : {}),
    durationMs: 0,
    captured: safeCaptureSummary(serializeToolPolicySubject(input.subject)),
  }
}

function serializeToolPolicySubject(subject: unknown): string {
  if (typeof subject === 'string') return subject
  try {
    return JSON.stringify(subject) ?? String(subject)
  } catch {
    return String(subject)
  }
}

function readToolCallInput(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'input' in value) {
    return (value as { readonly input?: unknown }).input
  }
  return value
}

function readToolResultOutput(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'output' in value) {
    return (value as { readonly output?: unknown }).output
  }
  return value
}

export const toolPolicy: ToolPolicyFactory = Object.assign(defineToolPolicy, {
  approval,
  args,
  result,
})
