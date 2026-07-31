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
import type { ModelInfo } from '../../types'
import type { GenerationSettings } from '../../generation/types'
import type { SkillActivationSession } from '../../skill/session'
import type { StepDirective } from '../executor-types'
import type { StructuredOutputCapabilities } from '../structured-output'
import type { ToolInputCapabilitiesResolution } from '../tool/session'
import type { ExecutionResolveOpts } from './types'
import { systemMessagePrefixPatch } from './system-prefix-patch'
import { preview } from '../../request/preview/preview'

/** Default maximum model/tool loop steps for both adapter dialects. */
export const DEFAULT_MAX_STEPS = 10

/**
 * Resolve how an SDK-loop dialect compiles tool input schemas for one model: the
 * model's verified profile, `unverified` (resolver present, model unknown → fail
 * before transport for schema'd tools), or the permissive `default` when the
 * runtime declares no structured-output resolver.
 */
export function resolveToolInputCapabilities(
  dialect: {
    readonly id: string
    readonly structuredOutput?: {
      capabilities(model: ModelInfo): StructuredOutputCapabilities | undefined
    }
  },
  modelInfo: ModelInfo,
): ToolInputCapabilitiesResolution {
  if (!dialect.structuredOutput) return { kind: 'default' }
  const capabilities = dialect.structuredOutput.capabilities(modelInfo)
  return capabilities
    ? { kind: 'verified', capabilities }
    : { kind: 'unverified', providerId: dialect.id, modelId: modelInfo.modelId }
}

/**
 * Build the loosely typed prompt resolve options used at the adapter boundary.
 *
 * @param args - Concrete provider/model identity plus call-site settings.
 * @returns Resolve options suitable for `AnyPrompt.resolve()`.
 */
export function buildResolveOpts(args: {
  readonly input?: Record<string, unknown>;
  readonly provider: string;
  readonly modelId: string;
  readonly settings?: GenerationSettings;
}): ExecutionResolveOpts {
  return {
    input: args.input,
    provider: args.provider,
    modelId: args.modelId,
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
    const prefixPatch = factory[systemMessagePrefixPatch]
    return {
      kind: 'amend',
      system: prefixPatch ? undefined : (caller.system ?? factory.system),
      systemBlocks: prefixPatch ? undefined : (caller.systemBlocks ?? factory.systemBlocks),
      tools: caller.tools ?? factory.tools,
      activeTools: caller.activeTools ?? factory.activeTools,
      [systemMessagePrefixPatch]: prefixPatch,
      refundStep: Boolean(caller.refundStep || factory.refundStep),
    }
  }
  return caller.kind === 'amend' ? caller : factory
}

/**
 * Collect best-effort request preview metadata for devtools.
 *
 * Preview must never block generation: observational planning errors are
 * swallowed and represented as an empty metadata object.
 */
export async function previewForDevtools(
  prompt: AnyPrompt,
  resolveOpts: ExecutionResolveOpts,
  tools: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  try {
    const { input, provider, modelId, ...settings } = resolveOpts
    const requestPreview = await preview(prompt, {
      input,
      provider,
      model: modelId || "unknown",
      settings,
      tools,
    })
    return { _preview: requestPreview }
  } catch {
    return {}
  }
}
