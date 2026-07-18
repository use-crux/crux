/** Candidate-aware Safety preparation for completed operations. */

import type { CompletedOperationResult } from '../../../completed-operation/contracts'
import { isImageCruxPrompt, prepareImagePrompt, type PreparedImagePrompt } from '../../../generation/image-prompt'
import type { ImagePrompt } from '../../../generation/image-contracts'
import { SafetyConfigError } from '../../../safety/errors'
import type { Guardrail } from '../../../safety/guardrail/types'
import type { Safety } from '../../../safety/session'
import type { CompletedOperationDefinition } from '../definition'
import { describeCompletedModel } from '../model-description'
import { preflightCompletedCandidate, preflightCompletedCandidates } from '../preflight'
import { completedModelLeaves } from '../routing'
import { createCompletedOperationSafety, guardCompletedOperationInput } from './execute'
import { guardGeneratedImageInput } from './image-input'
import type { CompletedOperationSafetyOptions } from './options'

/** Prepared state shared by routing, provider normalization, and final reporting. */
export interface CompletedCandidatePreparation<TInput, TNormalized> {
  readonly input: TInput
  readonly safety: Safety | undefined
  readonly normalized: ReadonlyMap<unknown, TNormalized>
  prepare(candidate: unknown, signal: AbortSignal): Promise<TNormalized>
}

/**
 * Prepare one completed-operation Safety lifecycle.
 *
 * Direct inputs retain eager all-leaf support preflight. Routed typed image
 * prompts resolve every provider/model projection only to validate a stable
 * prompt policy set; guarding and normalization remain lazy per attempted
 * candidate.
 */
export async function prepareCompletedOperationCandidates<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  options: Readonly<{
    definition: CompletedOperationDefinition<TModel, TInput, TNormalized, TNative, TResult, TReport>
    provider: string
    operation: string
    model: unknown
    input: TInput
  }> &
    CompletedOperationSafetyOptions,
  signal: AbortSignal,
): Promise<CompletedCandidatePreparation<TInput, TNormalized>> {
  const typedInput = options.input
  if (options.operation === 'generateImage' && isTypedImageInput(typedInput)) {
    return prepareTypedImageCandidates({ ...options, input: typedInput }, signal)
  }

  const safety = createCompletedOperationSafety(options)
  const input = await guardCompletedOperationInput(options.operation, options.input, safety)
  const normalized = await preflightCompletedCandidates({ ...options, input }, signal)
  return {
    input,
    safety,
    normalized,
    async prepare(candidate, candidateSignal) {
      if (normalized.has(candidate)) return normalized.get(candidate)!
      return preflightCompletedCandidate({ ...options, input }, candidate, candidateSignal)
    },
  }
}

async function prepareTypedImageCandidates<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  options: Readonly<{
    definition: CompletedOperationDefinition<TModel, TInput, TNormalized, TNative, TResult, TReport>
    provider: string
    operation: string
    model: unknown
    input: TInput & TypedImageInput
  }> &
    CompletedOperationSafetyOptions,
  signal: AbortSignal,
): Promise<CompletedCandidatePreparation<TInput, TNormalized>> {
  const projections = new Map<unknown, PreparedImagePrompt>()
  for (const candidate of unique(completedModelLeaves(options.model))) {
    throwIfAborted(signal)
    projections.set(
      candidate,
      await prepareImagePrompt(
        { prompt: options.input.prompt, input: options.input.input },
        {
          adapter: options.provider,
          model: describeCompletedModel(candidate) ?? 'unknown-model',
        },
      ),
    )
  }
  const first = projections.values().next().value as PreparedImagePrompt | undefined
  assertStablePromptPolicies([...projections.values()])

  const safety = createCompletedOperationSafety({
    ...options,
    promptId: first?.promptId,
    systemPrompt: first?.systemText,
    resolved: {
      guardrails: first?.guardrails,
      metadata: first?.metadata,
    },
  })
  const normalized = new Map<unknown, TNormalized>()
  return {
    input: options.input,
    safety,
    normalized,
    async prepare(candidate, candidateSignal) {
      if (normalized.has(candidate)) return normalized.get(candidate)!
      const projection = projections.get(candidate)
      if (!projection) throw new TypeError('Completed image routing selected an unprepared model candidate.')

      const direct = Object.freeze({
        ...options.input,
        model: candidate,
        prompt: projection.prompt,
      }) as TInput
      const guarded = safety
        ? await guardGeneratedImageInput(direct, safety, {
            preparedTypedPrompt: true,
            userText: projection.userText,
            systemText: projection.systemText,
            model: describeCompletedModel(candidate),
          })
        : direct
      const value = await preflightCompletedCandidate({ ...options, input: guarded }, candidate, candidateSignal)
      normalized.set(candidate, value)
      return value
    },
  }
}

function assertStablePromptPolicies(projections: readonly PreparedImagePrompt[]): void {
  const expected = projections[0]?.guardrails ?? []
  for (const projection of projections.slice(1)) {
    const actual = projection.guardrails ?? []
    if (sameGuardrailSet(expected, actual)) continue
    throw new SafetyConfigError({
      message:
        'Routed typed image prompts must resolve the same ordered Safety policy definitions and boundaries for every candidate.',
      kinds: ['guardrail'],
      scopes: ['prompt'],
    })
  }
}

function sameGuardrailSet(expected: readonly Guardrail[], actual: readonly Guardrail[]): boolean {
  if (expected.length !== actual.length) return false
  return expected.every((policy, index) => {
    const candidate = actual[index]
    return candidate === policy && sameBoundaries(policy, candidate)
  })
}

function sameBoundaries(left: Guardrail, right: Guardrail | undefined): boolean {
  if (!right) return false
  const leftBoundaries = Array.isArray(left.on) ? left.on : [left.on]
  const rightBoundaries = Array.isArray(right.on) ? right.on : [right.on]
  return (
    leftBoundaries.length === rightBoundaries.length &&
    leftBoundaries.every((boundary, index) => {
      const other = rightBoundaries[index]
      return other?.id === boundary.id && other.path === boundary.path
    })
  )
}

type TypedImageInput = Readonly<{
  readonly prompt: Exclude<ImagePrompt, string | Readonly<{ text: string }>>
  readonly input?: unknown
}>

function isTypedImageInput(value: unknown): value is TypedImageInput {
  if (typeof value !== 'object' || value === null || !('prompt' in value)) return false
  const prompt = value.prompt
  return typeof prompt === 'object' && prompt !== null && isImageCruxPrompt(prompt as Exclude<ImagePrompt, string>)
}

function unique(values: readonly unknown[]): readonly unknown[] {
  return [...new Set(values)]
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
}
