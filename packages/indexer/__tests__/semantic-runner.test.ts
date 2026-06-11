import { describe, expect, it } from 'vitest'
import type { ProjectRelation } from '@crux/core/project-index'
import { mergeSemanticAnalyzerResults } from '../indexer/semantic/runner'

function relation(input: {
  readonly id: string
  readonly fidelity: ProjectRelation['fidelity']
  readonly metadata?: ProjectRelation['metadata']
}): ProjectRelation {
  return {
    id: input.id,
    type: 'agent.uses_prompt',
    from: 'agent:writer',
    to: 'prompt:writer',
    fidelity: input.fidelity,
    metadata: input.metadata,
  }
}

describe('mergeSemanticAnalyzerResults', () => {
  it('merges relation facts by semantic identity so resolved facts replace provisional ids', () => {
    const partial = relation({
      id: 'static-relation:agent:writer:prompt:writer',
      fidelity: 'partial',
      metadata: { source: 'static' },
    })
    const resolved = relation({
      id: 'relation:agent.uses_prompt:agent:writer:prompt:writer',
      fidelity: 'resolved',
      metadata: { source: 'semantic' },
    })

    expect(mergeSemanticAnalyzerResults([{ relations: [partial] }, { relations: [resolved] }]).relations).toEqual([
      resolved,
    ])
  })
})
