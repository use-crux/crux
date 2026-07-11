import { describe, expect, it } from 'vitest'
import {
  constraintDefinitionRef,
  guardrailDefinitionRef,
  memoryDefinitionRef,
  recipeDefinitionRef,
  rerankerDefinitionRef,
  routingDefinitionRef,
  skillDefinitionRef,
  taskDefinitionRef,
  workspaceDefinitionRef,
} from '../../src/observability/definition-ref'

describe('routing definition refs (invoked-routing)', () => {
  it.each([
    ['router', 'routing.router'],
    ['split', 'routing.split'],
    ['retry', 'routing.retry'],
    ['cascade', 'routing.cascade'],
    ['fallback', 'routing.fallback'],
  ] as const)('builds %s ref as %s:<safeId(id)>', (kind, canonicalKind) => {
    expect(routingDefinitionRef(kind, 'my-router')).toEqual({
      id: `${canonicalKind}:my-router`,
      kind: canonicalKind,
      role: 'invoked-routing',
    })
  })

  it('safe_id normalizes the authored routing id', () => {
    expect(routingDefinitionRef('cascade', 'Cheap → Smart!').id).toBe(
      'routing.cascade:Cheap-Smart',
    )
  })
})

describe('skill / guardrail / constraint / task / workspace refs', () => {
  it('builds a skill ref from the composite registry:path identifier', () => {
    // safe_id keeps `:` but collapses `/` to `-`, matching the indexer.
    expect(skillDefinitionRef('skills:review/pr')).toEqual({
      id: 'skill:skills:review-pr',
      kind: 'skill',
      role: 'loaded-skill',
    })
  })

  it('builds a guardrail ref matching guardrail:<safeId(id)>', () => {
    expect(guardrailDefinitionRef('no-secrets')).toEqual({
      id: 'guardrail:no-secrets',
      kind: 'guardrail',
      role: 'invoked-guardrail',
    })
  })

  it('builds a constraint ref matching constraint:<safeId(id)>', () => {
    expect(constraintDefinitionRef('grounded')).toEqual({
      id: 'constraint:grounded',
      kind: 'constraint',
      role: 'invoked-constraint',
    })
  })

  it('builds a task ref matching task:<safeId(name)>', () => {
    expect(taskDefinitionRef('summarize')).toEqual({
      id: 'task:summarize',
      kind: 'task',
      role: 'invoked-task',
    })
  })

  it('builds a workspace ref matching workspace:<safeId(id)>', () => {
    expect(workspaceDefinitionRef('scratch')).toEqual({
      id: 'workspace:scratch',
      kind: 'workspace',
      role: 'invoked-workspace',
    })
  })
})

describe('memory / rag.recipe / rag.reranker refs', () => {
  it('builds a memory ref from the authored definition key', () => {
    expect(memoryDefinitionRef('user-facts')).toEqual({
      id: 'memory:user-facts',
      kind: 'memory',
      role: 'invoked-memory',
    })
  })

  it('builds a recipe ref matching rag.recipe:<safeId(name)>', () => {
    expect(recipeDefinitionRef('hybrid-search')).toEqual({
      id: 'rag.recipe:hybrid-search',
      kind: 'rag.recipe',
      role: 'invoked-recipe',
    })
  })

  it('builds a reranker ref matching rag.reranker:<safeId(id)>', () => {
    expect(rerankerDefinitionRef('cross-encoder')).toEqual({
      id: 'rag.reranker:cross-encoder',
      kind: 'rag.reranker',
      role: 'invoked-reranker',
    })
  })
})
