import { describe, expect, it } from 'vitest'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import { mergeDefinitionsById } from '../indexer/merge'

describe('mergeDefinitionsById', () => {
  it('preserves supporting source refs across richer duplicate definitions', () => {
    const sourceRef = {
      id: 'prompt:writer:source:schema:output:WriterSchema',
      role: 'schema',
      property: 'output',
      symbol: 'WriterSchema',
      source: { file: '/repo/prompts/writer.ts', line: 4 },
      snippet: {
        source: 'const WriterSchema = z.object({ title: z.string() })',
        language: 'ts',
        range: { file: '/repo/prompts/writer.ts', startLine: 4, startColumn: 1, endLine: 4, endColumn: 54 },
      },
      fidelity: 'resolved',
    } satisfies NonNullable<ProjectDefinition['sourceRefs']>[number]

    const staticDefinition: ProjectDefinition = {
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      source: { file: '/repo/prompts/writer.ts', line: 8 },
      fidelity: 'partial',
      status: 'active',
      fingerprint: 'static',
      metadata: { static: true },
      sourceRefs: [sourceRef],
    }

    const resolvedDefinition: ProjectDefinition = {
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      description: 'Runtime metadata',
      fidelity: 'resolved',
      status: 'active',
      fingerprint: 'resolved',
      metadata: { imported: true },
    }

    const [merged] = mergeDefinitionsById([staticDefinition, resolvedDefinition])

    expect(merged).toMatchObject({
      id: 'prompt:writer',
      fidelity: 'resolved',
      sourceRefs: [sourceRef],
    })
  })
})
