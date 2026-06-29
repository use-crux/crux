import { describe, expect, it } from 'vitest'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import { cruxCoreExtension } from '../indexer/extractors/crux-core-extension'
import { defineIndexerExtensionFixture, extractFixtureSource } from '../testing'

const cruxFixture = defineIndexerExtensionFixture(cruxCoreExtension)

describe('first-party memory extractor fixtures', () => {
  it('surfaces beta memory capture, budget, render, and retention metadata', async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const assistantMemory = memory({
          id: 'assistant',
          namespace: 'tenant:acme',
          capture: { mode: 'afterResponse' },
          budget: { maxTokens: 64 },
          blocks: [
            facts({
              id: 'facts',
              priority: 70,
              budget: { maxTokens: 24 },
              embed: async () => [1],
              write: { mode: 'propose' },
              render: { strategy: 'semantic', query: 'billing', limit: 3 },
            }),
            episodes({
              id: 'episodes',
              retention: '90d',
              render: { strategy: 'recent', limit: 2 },
            }),
          ],
        })
      `,
    )

    expect(definition(out.definitions, 'memory:assistant')).toMatchObject({
      kind: 'memory',
      name: 'assistant',
      metadata: expect.objectContaining({
        captureMode: 'afterResponse',
        budget: { maxTokens: 64 },
        facts: expect.objectContaining({
          captureMode: 'afterResponse',
          budget: { maxTokens: 64 },
        }),
      }),
    })
    expect(definition(out.definitions, 'memory.block:assistant:facts')).toMatchObject({
      kind: 'memory.block',
      name: 'facts',
      metadata: expect.objectContaining({
        budget: { maxTokens: 24 },
        renderStrategy: 'semantic',
        renderLimit: 3,
        facts: expect.objectContaining({
          budget: { maxTokens: 24 },
          renderStrategy: 'semantic',
          renderLimit: 3,
        }),
      }),
    })
    expect(definition(out.definitions, 'memory.block:assistant:episodes')).toMatchObject({
      kind: 'memory.block',
      name: 'episodes',
      metadata: expect.objectContaining({
        retentionPolicy: '90d',
        renderStrategy: 'recent',
        renderLimit: 2,
        facts: expect.objectContaining({
          retentionPolicy: '90d',
          renderStrategy: 'recent',
          renderLimit: 2,
        }),
      }),
    })
  })
})

function definition(definitions: readonly ProjectDefinition[], id: string): ProjectDefinition | undefined {
  return definitions.find((item) => item.id === id)
}
