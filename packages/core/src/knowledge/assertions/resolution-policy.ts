/**
 * Policy-backed assertion resolution helpers.
 *
 * @module
 */

import { z } from 'zod'
import type { KnowledgeModel } from '../model'
import type { AssertionRelationRecord } from './relations'
import type { AssertionDecisionEvidence } from './resolution'

export type PolicyResolutionItem = {
  readonly assertionId: string
  readonly type: string
  readonly data: unknown
}

/** Apply schema-validated model policy decisions to assertion partitions. Internal. */
export async function applyModelPolicy<TItem extends PolicyResolutionItem>(input: {
  readonly assertions: readonly TItem[]
  readonly relations: readonly AssertionRelationRecord[]
  readonly policy: { readonly id: string; readonly model: KnowledgeModel; readonly instructions?: string }
  readonly add: (partition: 'selected' | 'superseded' | 'contested' | 'unresolved', id: string, evidence: AssertionDecisionEvidence) => void
}): Promise<void> {
  const schema = z.object({
    decisions: z.array(z.object({
      partition: z.enum(['selected', 'superseded', 'contested', 'unresolved']),
      assertionId: z.string(),
      relatedAssertionId: z.string().optional(),
      note: z.string().optional(),
    }).strict()),
  }).strict()
  const result = await input.policy.model.generateObject({
    system: 'Resolve assertions into selected, superseded, contested, and unresolved partitions.',
    prompt: JSON.stringify({
      instructions: input.policy.instructions ?? '',
      assertions: input.assertions.map((assertion) => ({
        id: assertion.assertionId,
        type: assertion.type,
        data: assertion.data,
      })),
      relations: input.relations.map((relation) => ({
        id: relation.relationId,
        type: relation.type,
        from: relation.from.assertionId,
        to: relation.to.assertionId,
      })),
    }),
    schema,
  })
  const parsed = schema.safeParse(result.object)
  if (!parsed.success) return
  for (const item of parsed.data.decisions) {
    const evidence: AssertionDecisionEvidence = {
      kind: 'policy',
      policyId: input.policy.id,
      ...(item.note ? { note: item.note } : {}),
    }
    input.add(item.partition, item.assertionId, evidence)
    if (item.partition === 'contested' && item.relatedAssertionId) {
      input.add('contested', item.relatedAssertionId, evidence)
    }
  }
}
