import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  semanticDefinitionEnrichmentIndexFacts,
  semanticLintIndexFacts,
  semanticRelationIndexFacts,
  semanticSchemaIndexFacts,
  semanticSourceRefIndexFacts,
} from '../indexer/semantic'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-analyzer-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic schema analyzer', () => {
  it('resolves schema metadata and source refs across renamed exports', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/fragments.ts'),
      `
        import { z } from 'zod'

        export const NestedSchema = z.object({
          url: z.string().describe('Source URL'),
        })
      `,
    )
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'
        import { NestedSchema } from './fragments'

        export const WriterInput = z.object({
          topic: z.string().describe('Topic to write about'),
          source: NestedSchema.optional(),
        })
      `,
    )
    await writeFile(join(root, 'src/index.ts'), `export { WriterInput as input } from './schema'`)
    await writeFile(
      join(root, 'src/tool.ts'),
      `
        import { tool } from '@crux/core'
        import { input } from './index'

        export const writerTool = tool({
          name: 'writer',
          description: 'Write a draft',
          parameters: input,
          execute: async () => 'ok',
        })
      `,
    )

    const facts = semanticSchemaIndexFacts(root, [
      join(root, 'src/tool.ts'),
      join(root, 'src/index.ts'),
      join(root, 'src/schema.ts'),
      join(root, 'src/fragments.ts'),
    ])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'tool:writer',
        metadata: expect.objectContaining({
          inputSchema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              topic: expect.objectContaining({ type: 'string', description: 'Topic to write about' }),
              source: expect.objectContaining({
                properties: expect.objectContaining({
                  url: expect.objectContaining({ type: 'string', description: 'Source URL' }),
                }),
              }),
            }),
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'tool:writer',
        ref: expect.objectContaining({
          role: 'schema',
          property: 'parameters',
          symbol: 'WriterInput',
          source: expect.objectContaining({ file: join(root, 'src/schema.ts') }),
          metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'tool:writer',
        ref: expect.objectContaining({
          role: 'schema',
          property: 'parameters',
          symbol: 'NestedSchema',
          source: expect.objectContaining({ file: join(root, 'src/fragments.ts') }),
          metadata: expect.objectContaining({ nested: true }),
        }),
      }),
    )
  }, 15_000)
})

describe('semantic relation analyzer', () => {
  it('resolves direct agent graph edges through imported definitions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { prompt, tool } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer',
          system: 'Write clearly.',
        })

        export const outlineTool = tool({
          name: 'outline',
          description: 'Create an outline',
          execute: async () => 'ok',
        })
      `,
    )
    await writeFile(
      join(root, 'src/index.ts'),
      `export { writerPrompt as promptForAgent, outlineTool as toolForAgent } from './primitives'`,
    )
    await writeFile(
      join(root, 'src/agent.ts'),
      `
        import { agent } from '@crux/core'
        import { promptForAgent, toolForAgent } from './index'

        export const writerAgent = agent({
          name: 'Writer',
          prompt: promptForAgent,
          tools: { outline: toolForAgent },
        })
      `,
    )

    const facts = semanticRelationIndexFacts(root, [
      join(root, 'src/agent.ts'),
      join(root, 'src/index.ts'),
      join(root, 'src/primitives.ts'),
    ])

    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'agent.uses_prompt',
        from: 'agent:Writer',
        to: 'prompt:writer',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'agent.uses_tool',
        from: 'agent:Writer',
        to: 'tool:outline',
        fidelity: 'resolved',
      }),
    )
  })
})

describe('semantic source-ref analyzer', () => {
  it('resolves prompt fragments and agent tool-map contributors through imports', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/content.ts'),
      `
        export const WRITER_SYSTEM = 'Write clearly.'
        export const USER_PROMPT = 'Draft an outline.'
      `,
    )
    await writeFile(
      join(root, 'src/tools.ts'),
      `
        import { tool } from '@crux/core'

        export const outlineTool = tool({
          name: 'outline',
          description: 'Create an outline',
          execute: async () => 'ok',
        })

        export const writerTools = { outline: outlineTool }
      `,
    )
    await writeFile(
      join(root, 'src/barrel.ts'),
      `export { WRITER_SYSTEM, USER_PROMPT } from './content'; export { writerTools } from './tools'`,
    )
    await writeFile(
      join(root, 'src/index.ts'),
      `
        import { agent, prompt } from '@crux/core'
        import { USER_PROMPT, WRITER_SYSTEM, writerTools } from './barrel'

        export const writerPrompt = prompt({
          id: 'writer',
          system: WRITER_SYSTEM,
          prompt: USER_PROMPT,
        })

        export const writerAgent = agent({
          name: 'Writer',
          prompt: writerPrompt,
          tools: writerTools,
        })
      `,
    )

    const facts = semanticSourceRefIndexFacts(root, [
      join(root, 'src/index.ts'),
      join(root, 'src/barrel.ts'),
      join(root, 'src/content.ts'),
      join(root, 'src/tools.ts'),
    ])

    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'system',
          property: 'system',
          symbol: 'WRITER_SYSTEM',
          source: expect.objectContaining({ file: join(root, 'src/content.ts') }),
          metadata: expect.objectContaining({ fragment: true }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'prompt',
          property: 'prompt',
          symbol: 'USER_PROMPT',
          source: expect.objectContaining({ file: join(root, 'src/content.ts') }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'agent:Writer',
        ref: expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'writerTools',
          source: expect.objectContaining({ file: join(root, 'src/tools.ts') }),
        }),
      }),
    )
  })
})

describe('semantic definition-enrichment analyzer', () => {
  it('emits folded router route child definitions with target source refs', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/agent.ts'),
      `
        import { agent } from '@crux/core'

        export const writerAgent = agent({
          name: 'Writer',
        })
      `,
    )
    await writeFile(
      join(root, 'src/routes.ts'),
      `import { writerAgent } from './agent'; export const routes = { draft: writerAgent }`,
    )
    await writeFile(
      join(root, 'src/router.ts'),
      `
        import { router } from '@crux/core'
        import { routes } from './routes'

        export const writerRouter = router({
          id: 'writer-router',
          routes,
          classify: async () => 'draft',
        })
      `,
    )

    const facts = semanticDefinitionEnrichmentIndexFacts(root, [
      join(root, 'src/router.ts'),
      join(root, 'src/routes.ts'),
      join(root, 'src/agent.ts'),
    ])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'routing.router:writer-router:route:draft',
        kind: 'routing.router.route',
        name: 'draft',
        metadata: expect.objectContaining({
          targetDefinitionId: 'agent:Writer',
          targetKind: 'agent',
          indexPresentation: expect.objectContaining({
            parentDefinitionId: 'routing.router:writer-router',
            parentRelationType: 'router.includes_route',
            role: 'route',
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'routing.router:writer-router:route:draft',
        ref: expect.objectContaining({
          role: 'config',
          property: 'routes',
          symbol: 'writerAgent',
          source: expect.objectContaining({ file: join(root, 'src/agent.ts') }),
          metadata: expect.objectContaining({ routingTarget: true }),
        }),
      }),
    )
  })
})

describe('semantic lint-fact analyzer', () => {
  it('emits state-resource findings from aggregate semantic definitions and relations', () => {
    const facts = semanticLintIndexFacts({
      definitions: [
        {
          id: 'memory:drafts',
          kind: 'memory',
          name: 'drafts',
          fidelity: 'resolved',
        },
      ],
      relations: [
        {
          id: 'relation:tool.writes_memory:tool:writer:memory:drafts',
          type: 'tool.writes_memory',
          from: 'tool:writer',
          to: 'memory:drafts',
          fidelity: 'resolved',
        },
      ],
    })

    expect(facts.lintFindings).toContainEqual(
      expect.objectContaining({
        ruleId: 'resource.write_without_read',
        relatedDefinitionIds: ['memory:drafts'],
      }),
    )
  })
})
