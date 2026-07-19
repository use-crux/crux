import type { Asset } from '../asset/types'
import { createUnsupportedCapabilityError, type UnsupportedCapabilityIssue } from '../content/media-errors'
import type { ResolvedPrompt } from '../resolver/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { ImagePrompt, ImagePromptContent } from './image-contracts'

/** Provider and model identity used in pre-I/O image prompt errors. */
export interface ImagePromptLoweringContext {
  readonly adapter: string
  readonly model: string
}

/** Provider-neutral prompt and edit assets produced before native I/O. */
export interface LoweredImagePrompt {
  readonly text: string
  readonly images: readonly Asset[]
  readonly mask?: Asset
}

/** Provider-I/O-free image prompt projection retained for completed-operation Safety. */
export interface PreparedImagePrompt {
  /** Direct representation safe for provider normalization without another prompt resolution. */
  readonly prompt: string | ImagePromptContent
  /** Exact user-input text before provider-oriented system/prompt joining. */
  readonly userText?: string
  /** Exact model-input system text, when a typed prompt resolved one. */
  readonly systemText?: string
  readonly promptId?: string
  readonly guardrails?: readonly Guardrail[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Resolve a direct or composed image prompt through Crux's shared prompt pipeline.
 * Unsupported language-only behavior is aggregated before provider or storage I/O.
 */
export async function lowerImagePrompt<TPrompt extends ImagePrompt>(
  options: Readonly<{ prompt: TPrompt; input?: unknown }>,
  context: ImagePromptLoweringContext,
): Promise<LoweredImagePrompt> {
  const prepared = await prepareImagePrompt(options, context)
  return typeof prepared.prompt === 'string' ? { text: prepared.prompt, images: [] } : lowerContent(prepared.prompt)
}

/** Resolve an image prompt once while retaining exact Safety text boundaries. */
export async function prepareImagePrompt<TPrompt extends ImagePrompt>(
  options: Readonly<{ prompt: TPrompt; input?: unknown }>,
  context: ImagePromptLoweringContext,
): Promise<PreparedImagePrompt> {
  if (typeof options.prompt === 'string') {
    return { prompt: options.prompt, userText: options.prompt }
  }
  if (!isImageCruxPrompt(options.prompt)) {
    return { prompt: options.prompt, userText: options.prompt.text }
  }

  const resolved = await options.prompt.resolve({
    provider: context.adapter,
    modelId: context.model,
    ...(options.input === undefined ? {} : { input: options.input }),
  } as never)
  const issues = resolvedIssues(resolved)
  if (issues.length > 0) {
    throw createUnsupportedCapabilityError({
      ...context,
      issues: issues as [UnsupportedCapabilityIssue, ...UnsupportedCapabilityIssue[]],
    })
  }
  const systemText = resolved.system
  const userText = resolved.prompt
  return {
    prompt: [systemText, resolved.prompt].filter((part): part is string => Boolean(part)).join('\n'),
    ...(userText === undefined ? {} : { userText }),
    ...(systemText === undefined ? {} : { systemText }),
    ...(options.prompt.id === undefined ? {} : { promptId: options.prompt.id }),
    ...(resolved.guardrails === undefined ? {} : { guardrails: Object.freeze([...resolved.guardrails]) }),
    ...(resolved.metadata === undefined ? {} : { metadata: resolved.metadata }),
  }
}

function lowerContent(prompt: ImagePromptContent): LoweredImagePrompt {
  if (typeof prompt.text !== 'string') throw new TypeError('Image prompt text must be a string.')
  return {
    text: prompt.text,
    images: Object.freeze([...(prompt.images ?? [])]),
    ...(prompt.mask === undefined ? {} : { mask: prompt.mask }),
  }
}

/** Return whether an image prompt requires candidate-aware Crux resolution. */
export function isImageCruxPrompt(
  prompt: Exclude<ImagePrompt, string>,
): prompt is Extract<ImagePrompt, { readonly _tag: 'Prompt' }> {
  return '_tag' in prompt && prompt._tag === 'Prompt' && typeof prompt.resolve === 'function'
}

function resolvedIssues(resolved: ResolvedPrompt): UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = []
  if (resolved.messages) issues.push(issue('image.prompt.messages'))
  if (resolved.schema) issues.push(issue('image.output.structured'))
  if (resolved.tools && Object.keys(resolved.tools).length > 0) issues.push(issue('image.tools'))
  if (resolved.toolMiddleware) issues.push(issue('image.toolMiddleware'))
  if (resolved.toolApprovalDeclarations?.length) issues.push(issue('image.toolApproval'))
  if (resolved.activeTools?.length) issues.push(issue('image.activeTools'))
  if (resolved.constraints?.length) issues.push(issue('image.output.constraints'))
  if (resolved.memoryBindings?.length) issues.push(issue('image.memory'))
  for (const key of Object.keys(resolved.settings)) issues.push(issue(`image.settings.${key}`))
  return issues
}

function issue(capability: string): UnsupportedCapabilityIssue {
  return {
    capability,
    remediation: 'Remove this language-generation behavior from the image prompt.',
  }
}
