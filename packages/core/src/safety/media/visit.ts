import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'
import type { GuardrailAudit, GuardrailContext, MediaGuardrailRunResult } from '../guardrail/types'
import { validateMediaGuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import { finalizeMediaEvaluations, mediaBlockedError, mediaRunContext, type MediaEvaluation } from './evaluation'
import { findMediaGroupDependencyViolation, type MediaGroupDependency } from './groups'
import { mediaLocationAttributes } from './location'
import type { MediaPartLocation, MediaPartSubject } from './types'

export interface MediaVisitItem {
  readonly subject: MediaPartSubject
  readonly groupId: string
}

export interface MediaVisitGroup {
  readonly id: string
  readonly size: number
  readonly minimumRetained: number
}

interface VisitMediaOptions {
  readonly phase: 'input' | 'output'
  readonly bindings: readonly GuardrailBinding[]
  readonly items: readonly MediaVisitItem[]
  readonly groups: readonly MediaVisitGroup[]
  readonly dependencies?: readonly MediaGroupDependency[]
  readonly context: () => GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
  readonly onStrip?: (item: MediaVisitItem) => void
}

/** @internal Result of visiting canonical media in stable item/binding order. */
export interface MediaVisitResult {
  readonly subjects: readonly MediaPartSubject[]
  readonly actions: readonly string[]
  readonly ran: boolean
}

/** Visit media policies once and enforce each retention group's minimum size. */
export async function visitMedia(options: VisitMediaOptions): Promise<MediaVisitResult> {
  if (options.bindings.length === 0 || options.items.length === 0) {
    return {
      subjects: options.items.map(({ subject }) => subject),
      actions: [],
      ran: false,
    }
  }

  const retainedByGroup = new Map(options.groups.map((group) => [group.id, group.size]))
  const minimumByGroup = new Map(options.groups.map((group) => [group.id, group.minimumRetained]))
  const actions: string[] = []
  const stripped = new Set<MediaPartSubject>()
  const evaluations: MediaEvaluation[] = []

  for (const item of options.items) {
    const location: MediaPartLocation = {
      origin: item.subject.origin,
      partType: item.subject.part.type,
    }

    for (const binding of options.bindings) {
      const start = performance.now()
      const context = options.context()
      const span = observe.openSpan({
        name: binding.policy.id,
        primitive: 'guardrail.run',
        definitionRefs: [guardrailDefinitionRef(binding.policy.id)],
        attributes: {
          guardrailName: binding.policy.id,
          category: binding.policy.category,
          boundary: binding.boundary.id,
          mode: binding.mode,
          phase: options.phase,
          promptId: context.promptId,
          model: context.model,
          ...mediaLocationAttributes(location),
        },
      })

      let result: MediaGuardrailRunResult
      try {
        const value: unknown = await span.withContext(() =>
          binding.policy.run(item.subject as never, mediaRunContext(binding, context) as never),
        )
        result = validateMediaGuardrailRunResult(value, {
          policyId: binding.policy.id,
          boundary: binding.boundary.id,
        })
      } catch (error) {
        finalizeMediaEvaluations(options, evaluations)
        span.error(error)
        throw error
      }

      const escalatedToBlock =
        result.action === 'strip' &&
        binding.mode === 'enforce' &&
        retainedCount(retainedByGroup, item.groupId) <= minimumCount(minimumByGroup, item.groupId)
      const durationMs = performance.now() - start
      const evaluation: MediaEvaluation = {
        groupId: item.groupId,
        binding,
        result,
        location,
        model: context.model,
        durationMs,
        span,
        escalatedToBlock,
      }
      evaluations.push(evaluation)
      actions.push(result.action)

      if (result.action === 'block' && binding.mode === 'enforce') {
        finalizeMediaEvaluations(options, evaluations, evaluation)
        throw mediaBlockedError(options.phase, binding, result.reason, location, durationMs, false, context.model)
      }

      if (result.action === 'strip' && binding.mode === 'enforce') {
        if (escalatedToBlock) {
          finalizeMediaEvaluations(options, evaluations, evaluation)
          throw mediaBlockedError(options.phase, binding, result.reason, location, durationMs, true, context.model)
        }
        retainedByGroup.set(item.groupId, retainedCount(retainedByGroup, item.groupId) - 1)
        stripped.add(item.subject)
        options.onStrip?.(item)
        break
      }
    }
  }

  const violation = findMediaGroupDependencyViolation(options.dependencies ?? [], retainedByGroup)
  if (violation) {
    const evaluation = lastEnforcedStrip(evaluations, violation.requiredGroupId)
    if (!evaluation || evaluation.result.action !== 'strip') {
      finalizeMediaEvaluations(options, evaluations)
      throw new Error('Media dependency failed without an attributable enforced strip.')
    }
    evaluation.escalatedToBlock = true
    finalizeMediaEvaluations(options, evaluations, evaluation)
    throw mediaBlockedError(
      options.phase,
      evaluation.binding,
      evaluation.result.reason,
      evaluation.location,
      evaluation.durationMs,
      true,
      evaluation.model,
    )
  }

  finalizeMediaEvaluations(options, evaluations)

  return {
    subjects: options.items.map(({ subject }) => subject).filter((subject) => !stripped.has(subject)),
    actions,
    ran: true,
  }
}

function lastEnforcedStrip(evaluations: readonly MediaEvaluation[], groupId: string): MediaEvaluation | undefined {
  for (let index = evaluations.length - 1; index >= 0; index--) {
    const evaluation = evaluations[index]
    if (
      evaluation?.groupId === groupId &&
      evaluation.binding.mode === 'enforce' &&
      evaluation.result.action === 'strip'
    ) {
      return evaluation
    }
  }
  return undefined
}

function retainedCount(groups: ReadonlyMap<string, number>, groupId: string): number {
  const count = groups.get(groupId)
  if (count === undefined) throw new Error(`Missing media retention group "${groupId}".`)
  return count
}

function minimumCount(groups: ReadonlyMap<string, number>, groupId: string): number {
  const count = groups.get(groupId)
  if (count === undefined) throw new Error(`Missing media retention group "${groupId}".`)
  return count
}
