/**
 * Shared adapter execution utilities.
 *
 * These helpers are intentionally small and policy-neutral: they normalize
 * prompt resolve options, merge step directives, collect optional devtools
 * inspection payloads, and create disposable timeout signals.
 *
 * @internal
 * @module
 */

import type { AnyPrompt } from '../../prompt/prompt-types'
import type { GenerationSettings } from '../../generation/types'
import type { SkillActivationSession } from '../../skill/session'
import type { StepDirective } from '../executor-types'
import type { ExecutionResolveOpts } from './types'

/** Default maximum model/tool loop steps for both adapter dialects. */
export const DEFAULT_MAX_STEPS = 10

/**
 * Build the loosely typed prompt resolve options used at the adapter boundary.
 *
 * @param args - Concrete provider/model identity plus call-site settings.
 * @returns Resolve options suitable for `AnyPrompt.resolve()`.
 */
export function buildResolveOpts(args: {
  readonly input?: Record<string, unknown>
  readonly provider: string
  readonly modelId: string
  readonly tokenBudget?: number
  readonly settings?: GenerationSettings
}): ExecutionResolveOpts {
  return {
    input: args.input,
    provider: args.provider,
    modelId: args.modelId,
    tokenBudget: args.tokenBudget,
    ...(args.settings ?? {}),
  } as ExecutionResolveOpts
}

/** Build resolve options for a skill-triggered re-resolution. */
export function withSkillActivationInput(
  resolveOpts: ExecutionResolveOpts,
  session: SkillActivationSession,
): ExecutionResolveOpts {
  const opts = resolveOpts as ExecutionResolveOpts & { readonly input?: Record<string, unknown> }
  return {
    ...opts,
    input: session.resolveInput(opts.input),
  } as unknown as ExecutionResolveOpts
}

/**
 * Merge the factory's step directive with a caller-provided observer directive.
 *
 * `stop` always wins, caller `amend` fields override factory amendments, and
 * either side can request a step refund.
 */
export function mergeDirectives(factory: StepDirective, caller: StepDirective | undefined): StepDirective {
  if (!caller) return factory
  if (caller.kind === 'stop') return caller
  if (factory.kind === 'stop') return factory
  if (factory.kind === 'amend' && caller.kind === 'amend') {
    return {
      kind: 'amend',
      system: caller.system ?? factory.system,
      systemBlocks: caller.systemBlocks ?? factory.systemBlocks,
      tools: caller.tools ?? factory.tools,
      activeTools: caller.activeTools ?? factory.activeTools,
      refundStep: Boolean(caller.refundStep || factory.refundStep),
    }
  }
  return caller.kind === 'amend' ? caller : factory
}

/**
 * Collect best-effort prompt inspection metadata for devtools.
 *
 * Inspection must never block generation: prompt inspection errors are
 * swallowed and represented as an empty metadata object.
 */
export async function inspectForDevtools(
  prompt: AnyPrompt,
  resolveOpts: ExecutionResolveOpts,
  tools: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  try {
    const inspectResult = await prompt.inspect(resolveOpts as Parameters<AnyPrompt['inspect']>[0])
    if (tools) {
      const allToolNames = Object.keys(tools)
      if (allToolNames.length > 0) inspectResult.tools = allToolNames
    }
    return { _inspect: inspectResult }
  } catch {
    return {}
  }
}

/**
 * Create an abort signal and cleanup hook for a generation timeout.
 *
 * @param timeoutMs - Wall-clock timeout in milliseconds. Non-positive values disable timeout handling.
 * @returns An optional signal and a `dispose()` function that clears timers.
 */
export function createTimeoutSignal(timeoutMs: number | undefined): {
  signal: AbortSignal | undefined
  dispose: () => void
} {
  if (!timeoutMs || timeoutMs <= 0) return { signal: undefined, dispose: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException(`Generation timed out after ${timeoutMs}ms`, 'AbortError')),
    timeoutMs,
  )
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}
