import { describe, expect, it } from 'vitest'
import type { ProjectDefinition } from '@crux/core/project-index'
import { cruxCoreExtension } from '../indexer/extractors/crux-core-extension'
import {
  assertDeterministicExtraction,
  defineIndexerExtensionFixture,
  extractFixtureSource,
} from '../testing'

const cruxFixture = defineIndexerExtensionFixture(cruxCoreExtension)

describe('first-party extractor fixtures', () => {
  it('extracts prompt and context facts through the public fixture engine', async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const brandContext = context({
          id: 'brand-context',
          system: 'Use the brand voice.',
        })

        export const writerPrompt = prompt({
          id: 'writer',
          use: [brandContext],
          system: 'Write in the requested style.',
          prompt: () => 'Draft copy',
        })
      `,
    )

    expect(definition(out.definitions, 'context:brand-context')).toMatchObject({
      kind: 'context',
      name: 'brand-context',
      metadata: expect.objectContaining({
        exportName: 'brandContext',
        isStatic: true,
        facts: expect.objectContaining({
          kind: 'context',
          isStatic: true,
        }),
      }),
    })
    expect(definition(out.definitions, 'prompt:writer')).toMatchObject({
      kind: 'prompt',
      name: 'writer',
      metadata: expect.objectContaining({
        exportName: 'writerPrompt',
        facts: expect.objectContaining({
          kind: 'prompt',
          hasSystem: true,
          hasPrompt: true,
          useEntries: expect.arrayContaining([expect.objectContaining({ variable: 'brandContext' })]),
        }),
      }),
    })
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'prompt.uses_context',
          from: 'prompt:writer',
          to: 'context:brand-context',
        }),
      ]),
    )
    await expect(
      assertDeterministicExtraction(
        cruxFixture,
        `export const writerPrompt = prompt({ id: 'writer', prompt: 'Draft copy' })`,
      ),
    ).resolves.toBeUndefined()
  })

  it('extracts tool schemas and execution metadata without parser-native test contexts', async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const searchDocs = createTool({
          name: 'searchDocs',
          description: 'Search documentation',
          parameters: {
            query: 'string',
          },
          execute: async () => 'result',
        })
      `,
    )

    expect(definition(out.definitions, 'tool:searchDocs')).toMatchObject({
      kind: 'tool',
      name: 'searchDocs',
      metadata: expect.objectContaining({
        exportName: 'searchDocs',
        hasExecute: true,
        facts: expect.objectContaining({
          kind: 'tool',
          toolName: 'searchDocs',
          hasExecute: true,
        }),
      }),
    })
  })

  it('extracts agent prompt and tool relations from source text', async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })
        export const searchDocs = createTool({
          name: 'searchDocs',
          description: 'Search documentation',
          parameters: { query: 'string' },
          execute: async () => 'result',
        })

        export const writerAgent = agent({
          id: 'writer-agent',
          prompt: writerPrompt,
          tools: [searchDocs],
        })
      `,
    )

    expect(definition(out.definitions, 'agent:writer-agent')).toMatchObject({
      kind: 'agent',
      name: 'writer-agent',
      metadata: expect.objectContaining({
        exportName: 'writerAgent',
        facts: expect.objectContaining({
          kind: 'agent',
          promptId: 'writerPrompt',
          toolNames: ['searchDocs'],
        }),
      }),
    })
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.uses_prompt',
          from: 'agent:writer-agent',
          to: 'prompt:writer',
        }),
        expect.objectContaining({
          type: 'agent.uses_tool',
          from: 'agent:writer-agent',
          to: 'tool:searchDocs',
        }),
      ]),
    )
  })

  it('extracts routing routers as folded child graphs', async () => {
    const out = await extractFixtureSource(
      cruxFixture,
      `
        export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })

        export const qualityRouter = router({
          id: 'quality-router',
          routes: {
            default: writerPrompt,
          },
          classify: () => 'default',
        })
      `,
    )

    expect(definition(out.definitions, 'routing.router:quality-router')).toMatchObject({
      kind: 'routing.router',
      name: 'quality-router',
      metadata: expect.objectContaining({
        exportName: 'qualityRouter',
        routeKeys: ['default'],
        routeCount: 1,
        hasDefaultRoute: true,
        hasClassify: true,
      }),
    })
    expect(definition(out.definitions, 'routing.router:quality-router:route:default')).toMatchObject({
      kind: 'routing.router.route',
      name: 'default',
      metadata: expect.objectContaining({
        routerDefinitionId: 'routing.router:quality-router',
        routeKey: 'default',
        targetVariable: 'writerPrompt',
      }),
    })
    expect(out.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'router.includes_route',
          from: 'routing.router:quality-router',
          to: 'routing.router:quality-router:route:default',
        }),
        expect.objectContaining({
          type: 'router.route.uses_prompt',
          from: 'routing.router:quality-router:route:default',
          to: 'prompt:writer',
        }),
      ]),
    )
  })
})

function definition(definitions: readonly ProjectDefinition[], id: string): ProjectDefinition | undefined {
  return definitions.find((item) => item.id === id)
}
