import type { Asset } from '../asset/types'
import { createUnsupportedCapabilityError, type UnsupportedCapabilityIssue } from '../content/media-errors'
import type { ResolvedPrompt } from '../resolver/types'
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

/**
 * Resolve a direct or composed image prompt through Crux's shared prompt pipeline.
 * Unsupported language-only behavior is aggregated before provider or storage I/O.
 */
export async function lowerImagePrompt<TPrompt extends ImagePrompt>(
  options: Readonly<{ prompt: TPrompt; input?: unknown; tokenBudget?: number }>,
  context: ImagePromptLoweringContext,
): Promise<LoweredImagePrompt> {
  validateTokenBudget(options.tokenBudget)
  if (typeof options.prompt === 'string') return { text: options.prompt, images: [] }
  if (!isCruxPrompt(options.prompt)) return lowerContent(options.prompt)

  const resolved = await options.prompt.resolve({
    provider: context.adapter,
    modelId: context.model,
    tokenBudget: options.tokenBudget,
    ...(options.input === undefined ? {} : { input: options.input }),
  } as never)
  const issues = resolvedIssues(resolved)
  if (issues.length > 0) {
    throw createUnsupportedCapabilityError({
      ...context,
      issues: issues as [UnsupportedCapabilityIssue, ...UnsupportedCapabilityIssue[]],
    })
  }
  return {
    text: [resolved.system, resolved.prompt].filter((part): part is string => Boolean(part)).join('\n\n'),
    images: [],
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

function isCruxPrompt(prompt: Exclude<ImagePrompt, string>): prompt is Extract<ImagePrompt, { readonly _tag: 'Prompt' }> {
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
  if (resolved.guardrails?.length) issues.push(issue('image.safety.guardrails'))
  if (resolved.memoryBindings?.length) issues.push(issue('image.memory'))
  for (const key of Object.keys(resolved.settings)) issues.push(issue(`image.settings.${key}`))
  return issues
}

function issue(capability: string): UnsupportedCapabilityIssue {
  return { capability, remediation: 'Remove this language-generation behavior from the image prompt.' }
}

function validateTokenBudget(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError('Image prompt tokenBudget must be a positive safe integer.')
  }
}
