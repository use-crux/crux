import { describe, expect, it } from 'vitest'
import type { DefinitionRef } from '@use-crux/core/observability'
import { definitionRefLinks } from './definition-ref-links'

describe('definitionRefLinks', () => {
  const refs: DefinitionRef[] = [
    { id: 'agent:router', kind: 'agent', role: 'invoked-agent' },
    { id: 'flow:onboarding', kind: 'flow', role: 'invoked-flow' },
    {
      id: 'retriever:deleted',
      kind: 'rag.retriever',
      role: 'invoked-retriever',
      source: { file: 'src/retrieval.ts', line: 8 },
    },
  ]

  it('uses each canonical ref.id directly for generic Catalog navigation', () => {
    const links = definitionRefLinks(refs, new Set(['agent:router', 'flow:onboarding']))
    expect(links[0]?.to).toEqual({ view: 'library-index', promptId: 'agent:router' })
    expect(links[1]?.to).toEqual({ view: 'library-index', promptId: 'flow:onboarding' })
  })

  it('keeps deleted refs visible with role, kind, source, and no dead link', () => {
    const deleted = definitionRefLinks(refs, new Set(['agent:router', 'flow:onboarding']))[2]
    expect(deleted).toMatchObject({
      value: 'retriever:deleted',
      kind: 'rag.retriever',
      role: 'invoked-retriever',
      source: { file: 'src/retrieval.ts', line: 8 },
      resolved: false,
    })
    expect(deleted?.to).toBeUndefined()
  })

  it('treats an unloaded index as unresolved rather than risking a dead link', () => {
    expect(definitionRefLinks([refs[0]!], undefined)[0]?.resolved).toBe(false)
  })
})
