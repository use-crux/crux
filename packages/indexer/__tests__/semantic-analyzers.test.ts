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

  it('resolves injectable input schemas through imports', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'

        export const BrandInput = z.object({
          locale: z.string().describe('Locale code'),
        })
      `,
    )
    await writeFile(
      join(root, 'src/injectable.ts'),
      `
        import { injectable } from '@crux/core'
        import { BrandInput } from './schema'

        export const brandInjection = injectable({
          id: 'brand',
          input: BrandInput,
          inject: async () => ({})
        })
      `,
    )

    const facts = semanticSchemaIndexFacts(root, [join(root, 'src/injectable.ts'), join(root, 'src/schema.ts')])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'injectable:brand',
        kind: 'injectable',
        metadata: expect.objectContaining({
          inputSchema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              locale: expect.objectContaining({ type: 'string', description: 'Locale code' }),
            }),
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'injectable:brand',
        ref: expect.objectContaining({
          role: 'schema',
          property: 'input',
          symbol: 'BrandInput',
          source: expect.objectContaining({ file: join(root, 'src/schema.ts') }),
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

  it('resolves imported and spread use arrays for prompts, contexts, and injectables', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { context, injectable, memory } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const localeContext = context({ id: 'locale' })
        export const guardInjection = injectable({ id: 'guard', inject: async () => ({}) })
        export const nestedInjection = injectable({ id: 'nested', inject: async () => ({}) })
        export const sessionMemory = memory({ id: 'session' })

        export const sharedUse = [brandContext, guardInjection] as const
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { context, injectable, prompt } from '@crux/core'
        import { brandContext, guardInjection, localeContext, nestedInjection, sessionMemory, sharedUse } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer',
          use: [...sharedUse, localeContext, sessionMemory],
        })

        export const writerContext = context({
          id: 'writer-context',
          use: [guardInjection],
        })

        export const writerInjection = injectable({
          id: 'writer-injection',
          use: [brandContext, sessionMemory, nestedInjection],
          inject: async () => ({})
        })
      `,
    )

    const facts = semanticRelationIndexFacts(root, [join(root, 'src/authoring.ts'), join(root, 'src/primitives.ts')])

    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'prompt.uses_context',
        from: 'prompt:writer:use:1',
        to: 'context:brand',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'prompt.uses_injectable',
        from: 'prompt:writer:use:2',
        to: 'injectable:guard',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'prompt.uses_context',
        from: 'prompt:writer:use:3',
        to: 'context:locale',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'prompt.uses_memory',
        from: 'prompt:writer:use:4',
        to: 'memory:session',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'context.uses_injectable',
        from: 'context:writer-context:use:1',
        to: 'injectable:guard',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'injectable.uses_context',
        from: 'injectable:writer-injection:use:1',
        to: 'context:brand',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).toContainEqual(
      expect.objectContaining({
        type: 'injectable.uses_memory',
        from: 'injectable:writer-injection:use:2',
        to: 'memory:session',
        fidelity: 'resolved',
      }),
    )
    expect(facts.relations).not.toContainEqual(
      expect.objectContaining({
        type: 'injectable.uses_injectable',
        from: 'injectable:writer-injection:use:3',
        to: 'injectable:nested',
      }),
    )
  }, 15_000)

  it('resolves imported and spread tool maps for prompts, contexts, and injectables', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/tools.ts'),
      `
        import { tool } from '@crux/core'

        export const searchTool = tool({ name: 'search', execute: async () => ({}) })
        export const citeTool = tool({ name: 'cite', execute: async () => ({}) })
        export const summarizeTool = tool({ name: 'summarize', execute: async () => ({}) })

        export const baseTools = { search: searchTool, cite: citeTool } as const
        export const editorialTools = { ...baseTools, summarize: summarizeTool } as const

        export function injectEditorialTools() {
          return { tools: editorialTools }
        }
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { context, injectable, prompt } from '@crux/core'
        import { baseTools, editorialTools, injectEditorialTools, summarizeTool } from './tools'

        export const writerPrompt = prompt({
          id: 'writer-tools',
          tools: editorialTools,
        })

        export const writerContext = context({
          id: 'writer-tool-context',
          tools: { ...baseTools, summarize: summarizeTool },
        })

        export const writerInjection = injectable({
          id: 'writer-tool-injection',
          inject: injectEditorialTools,
        })
      `,
    )

    const facts = semanticRelationIndexFacts(root, [join(root, 'src/authoring.ts'), join(root, 'src/tools.ts')])

    for (const type of ['prompt.uses_tool', 'context.uses_tool', 'injectable.uses_tool'] as const) {
      const from =
        type === 'prompt.uses_tool'
          ? 'prompt:writer-tools'
          : type === 'context.uses_tool'
            ? 'context:writer-tool-context'
            : 'injectable:writer-tool-injection'
      for (const toolId of ['tool:search', 'tool:cite', 'tool:summarize']) {
        expect(facts.relations).toContainEqual(
          expect.objectContaining({
            type,
            from,
            to: toolId,
            fidelity: 'resolved',
          }),
        )
      }
    }
  }, 15_000)
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

  it('resolves injection use and tool-map config source refs', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { context, tool } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const sharedUse = [brandContext] as const

        export const searchTool = tool({ name: 'search', execute: async () => ({}) })
        export const summarizeTool = tool({ name: 'summarize', execute: async () => ({}) })
        export const baseTools = { search: searchTool } as const
        export const editorialTools = { ...baseTools, summarize: summarizeTool } as const
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { context, injectable, prompt } from '@crux/core'
        import { baseTools, editorialTools, sharedUse, summarizeTool } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer',
          use: sharedUse,
          tools: editorialTools,
        })

        export const writerContext = context({
          id: 'writer-context',
          use: sharedUse,
          tools: { ...baseTools, summarize: summarizeTool },
        })

        export const writerInjection = injectable({
          id: 'writer-injection',
          use: sharedUse,
          inject: async () => ({}),
        })
      `,
    )

    const facts = semanticSourceRefIndexFacts(root, [join(root, 'src/authoring.ts'), join(root, 'src/primitives.ts')])

    for (const definitionId of ['prompt:writer', 'context:writer-context', 'injectable:writer-injection']) {
      expect(facts.sourceRefs).toContainEqual(
        expect.objectContaining({
          definitionId,
          ref: expect.objectContaining({
            role: 'config',
            property: 'use',
            symbol: 'sharedUse',
            source: expect.objectContaining({ file: join(root, 'src/primitives.ts') }),
          }),
        }),
      )
    }
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'editorialTools',
          source: expect.objectContaining({ file: join(root, 'src/primitives.ts') }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'context:writer-context',
        ref: expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'baseTools',
          source: expect.objectContaining({ file: join(root, 'src/primitives.ts') }),
          metadata: expect.objectContaining({ toolMapContributor: 'spread' }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'context:writer-context',
        ref: expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'summarizeTool',
          source: expect.objectContaining({ file: join(root, 'src/primitives.ts') }),
          metadata: expect.objectContaining({ toolMapContributor: 'property' }),
        }),
      }),
    )
  })

  it('resolves injectable inject callback source refs', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/callbacks.ts'),
      `
        export async function injectBrand() {
          return {}
        }
      `,
    )
    await writeFile(
      join(root, 'src/injectable.ts'),
      `
        import { injectable } from '@crux/core'
        import { injectBrand } from './callbacks'

        export const brandInjection = injectable({
          id: 'brand',
          inject: injectBrand,
        })
      `,
    )

    const facts = semanticSourceRefIndexFacts(root, [join(root, 'src/injectable.ts'), join(root, 'src/callbacks.ts')])

    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'injectable:brand',
        ref: expect.objectContaining({
          role: 'callback',
          property: 'inject',
          symbol: 'injectBrand',
          source: expect.objectContaining({ file: join(root, 'src/callbacks.ts'), function: 'injectBrand' }),
        }),
      }),
    )
  })

  it('emits condition-specific source refs for injectable use helpers', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { blackboard, context, injectable, memory } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const policyContext = context({ id: 'policy' })
        export const guardInjection = injectable({ id: 'guard', inject: async () => ({}) })
        export const sessionMemory = memory({ id: 'session' })
        export const draftBoard = blackboard({ id: 'drafts' })
      `,
    )
    await writeFile(
      join(root, 'src/conditions.ts'),
      `
        export function hasBrand(input: { brand?: string }) {
          return Boolean(input.brand)
        }

        export const includeDraftBoard = true
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { match, prompt, when } from '@crux/core'
        import { includeDraftBoard, hasBrand } from './conditions'
        import { brandContext, draftBoard, guardInjection, policyContext, sessionMemory } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer',
          use: [
            when(hasBrand, brandContext),
            match({
              cases: {
                strict: [policyContext, guardInjection],
              },
              default: sessionMemory,
            }),
            includeDraftBoard && draftBoard,
          ],
        })
      `,
    )

    const facts = semanticSourceRefIndexFacts(root, [
      join(root, 'src/authoring.ts'),
      join(root, 'src/conditions.ts'),
      join(root, 'src/primitives.ts'),
    ])

    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'policy',
          property: 'use',
          symbol: 'hasBrand',
          source: expect.objectContaining({ file: join(root, 'src/conditions.ts'), function: 'hasBrand' }),
          metadata: expect.objectContaining({
            extensions: expect.objectContaining({ injectionCondition: 'when-predicate', via: 'when' }),
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'config',
          property: 'use',
          symbol: 'brandContext',
          source: expect.objectContaining({ file: join(root, 'src/primitives.ts') }),
          metadata: expect.objectContaining({
            extensions: expect.objectContaining({ injectionCondition: 'when-target', via: 'when' }),
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'config',
          property: 'use',
          symbol: 'match-case:strict',
          fidelity: 'partial',
          metadata: expect.objectContaining({
            extensions: expect.objectContaining({ injectionCondition: 'match-case', via: 'match', branch: 'strict' }),
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'config',
          property: 'use',
          symbol: 'sessionMemory',
          metadata: expect.objectContaining({
            extensions: expect.objectContaining({
              injectionCondition: 'match-default',
              via: 'match',
              branch: 'default',
            }),
          }),
        }),
      }),
    )
    expect(facts.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:writer',
        ref: expect.objectContaining({
          role: 'policy',
          property: 'use',
          symbol: 'includeDraftBoard',
          source: expect.objectContaining({ file: join(root, 'src/conditions.ts') }),
          metadata: expect.objectContaining({
            extensions: expect.objectContaining({ injectionCondition: 'binary-guard', via: 'binary' }),
          }),
        }),
      }),
    )
  })
})

describe('semantic definition-enrichment analyzer', () => {
  it('emits resolved useEntries for imported and spread use arrays', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { blackboard, context, injectable, memory } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const guardInjection = injectable({ id: 'guard', inject: async () => ({}) })
        export const sessionMemory = memory({ id: 'session' })
        export const draftBoard = blackboard({ id: 'drafts' })
        export const baseUse = [brandContext, guardInjection] as const
        export const sharedUse = [...baseUse, sessionMemory, draftBoard] as const
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { context, injectable, prompt } from '@crux/core'
        import { baseUse, sharedUse } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer',
          use: sharedUse,
        })

        export const writerContext = context({
          id: 'writer-context',
          use: [...sharedUse],
        })

        export const writerInjection = injectable({
          id: 'writer-injection',
          use: baseUse,
          inject: async () => ({})
        })
      `,
    )

    const facts = semanticDefinitionEnrichmentIndexFacts(root, [
      join(root, 'src/authoring.ts'),
      join(root, 'src/primitives.ts'),
    ])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'prompt:writer',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: expect.arrayContaining([
              expect.objectContaining({
                variable: 'brandContext',
                targetDefinitionId: 'context:brand',
                targetKind: 'context',
                relationType: 'prompt.uses_context',
                relationFidelity: 'resolved',
                via: 'spread',
              }),
              expect.objectContaining({
                variable: 'guardInjection',
                targetDefinitionId: 'injectable:guard',
                targetKind: 'injectable',
                relationType: 'prompt.uses_injectable',
                via: 'spread',
              }),
              expect.objectContaining({
                variable: 'sessionMemory',
                targetDefinitionId: 'memory:session',
                targetKind: 'memory',
                relationType: 'prompt.uses_memory',
                via: 'array-ref',
              }),
              expect.objectContaining({
                variable: 'draftBoard',
                targetDefinitionId: 'blackboard:drafts',
                targetKind: 'blackboard',
                relationType: 'prompt.uses_blackboard',
                via: 'array-ref',
              }),
            ]),
          }),
        }),
      }),
    )
    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'context:writer-context',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: expect.arrayContaining([
              expect.objectContaining({
                variable: 'brandContext',
                targetDefinitionId: 'context:brand',
                relationType: 'context.uses_context',
                via: 'spread',
              }),
            ]),
          }),
        }),
      }),
    )
    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'injectable:writer-injection',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: expect.arrayContaining([
              expect.objectContaining({
                variable: 'brandContext',
                targetDefinitionId: 'context:brand',
                relationType: 'injectable.uses_context',
                via: 'array-ref',
              }),
            ]),
          }),
        }),
      }),
    )
    expect(facts.definitions).not.toContainEqual(
      expect.objectContaining({
        id: 'injectable:writer-injection',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: expect.arrayContaining([
              expect.objectContaining({
                variable: 'guardInjection',
                targetDefinitionId: 'injectable:guard',
              }),
            ]),
          }),
        }),
      }),
    )
  }, 15_000)

  it('emits resolved conditional useEntries for helper-shaped use entries', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { blackboard, context, injectable, memory } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const policyContext = context({ id: 'policy' })
        export const guardInjection = injectable({ id: 'guard', inject: async () => ({}) })
        export const sessionMemory = memory({ id: 'session' })
        export const draftBoard = blackboard({ id: 'drafts' })
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { match, prompt, when } from '@crux/core'
        import { brandContext, draftBoard, guardInjection, policyContext, sessionMemory } from './primitives'

        const includeDraftBoard = true

        export const writerPrompt = prompt({
          id: 'writer',
          use: [
            when((input) => input.brand, brandContext),
            match({
              cases: {
                strict: [policyContext, guardInjection],
              },
              default: sessionMemory,
            }),
            includeDraftBoard && draftBoard,
          ],
        })
      `,
    )

    const facts = semanticDefinitionEnrichmentIndexFacts(root, [
      join(root, 'src/authoring.ts'),
      join(root, 'src/primitives.ts'),
    ])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'prompt:writer',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: expect.arrayContaining([
              expect.objectContaining({
                variable: 'brandContext',
                targetDefinitionId: 'context:brand',
                relationType: 'prompt.uses_context',
                relationFidelity: 'resolved',
                conditionality: 'when',
                via: 'when',
              }),
              expect.objectContaining({
                variable: 'policyContext',
                targetDefinitionId: 'context:policy',
                relationType: 'prompt.uses_context',
                conditionality: 'match-case',
                branch: 'strict',
                via: 'match',
              }),
              expect.objectContaining({
                variable: 'guardInjection',
                targetDefinitionId: 'injectable:guard',
                relationType: 'prompt.uses_injectable',
                conditionality: 'match-case',
                branch: 'strict',
                via: 'match',
              }),
              expect.objectContaining({
                variable: 'sessionMemory',
                targetDefinitionId: 'memory:session',
                relationType: 'prompt.uses_memory',
                conditionality: 'match-default',
                branch: 'default',
                via: 'match',
              }),
              expect.objectContaining({
                variable: 'draftBoard',
                targetDefinitionId: 'blackboard:drafts',
                relationType: 'prompt.uses_blackboard',
                conditionality: 'binary-guard',
                via: 'binary',
              }),
            ]),
          }),
        }),
      }),
    )
  }, 15_000)

  it('emits dynamic and partial semantic facts for unsupported injection shapes', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/primitives.ts'),
      `
        import { context, tool } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const searchTool = tool({ name: 'search', description: 'Search', execute: async () => null })
        export const citeTool = tool({ name: 'cite', description: 'Cite', execute: async () => null })

        function buildUse() {
          return Math.random() > 0.5 ? [brandContext] : []
        }

        function makeToolMap() {
          return Math.random() > 0.5 ? { cite: citeTool } : {}
        }

        const dynamicName = 'computed'

        export const dynamicUse = buildUse()
        export const partialTools = {
          search: searchTool,
          ...makeToolMap(),
          [dynamicName]: citeTool,
        }
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { context, injectable, prompt } from '@crux/core'
        import { dynamicUse, partialTools } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer',
          use: dynamicUse,
          tools: partialTools,
        })

        export const writerContext = context({
          id: 'writer-context',
          tools: partialTools,
        })

        export const writerInjection = injectable({
          id: 'writer-injection',
          inject: async () => ({
            tools: partialTools,
          }),
        })
      `,
    )

    const facts = semanticDefinitionEnrichmentIndexFacts(root, [
      join(root, 'src/authoring.ts'),
      join(root, 'src/primitives.ts'),
    ])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'prompt:writer',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: expect.arrayContaining([
              expect.objectContaining({
                variable: 'dynamicUse',
                relationHint: 'unknown',
                conditionality: 'dynamic',
                via: 'array-ref',
              }),
            ]),
            tools: expect.objectContaining({
              hasTools: true,
              dynamic: true,
              names: expect.arrayContaining(['search']),
              variables: expect.arrayContaining(['search', 'cite']),
            }),
          }),
        }),
      }),
    )
    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'context:writer-context',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            tools: expect.objectContaining({
              hasTools: true,
              dynamic: true,
              names: expect.arrayContaining(['search']),
            }),
          }),
        }),
      }),
    )
    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'injectable:writer-injection',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            tools: expect.objectContaining({
              hasTools: true,
              dynamic: true,
              variables: expect.arrayContaining(['search', 'cite']),
            }),
          }),
        }),
      }),
    )
  }, 15_000)

  it('emits injectable return contribution facts for safety and metadata surfaces', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/safety.ts'),
      `
        import { constraint, guardrail } from '@crux/core'

        export const safeTone = constraint({ name: 'safe-tone', check: () => ({ ok: true }) })
        export const factuality = constraint({ name: 'factuality', check: () => ({ ok: true }) })
        export const outputGuard = guardrail({ name: 'output-guard', phase: 'output', validate: () => ({ action: 'pass' }) })
        export const piiGuard = guardrail({ name: 'pii-guard', phase: 'output', validate: () => ({ action: 'pass' }) })

        export const baseConstraints = [safeTone] as const
        export const extraConstraints = [factuality] as const
        export const guardrails = [outputGuard, piiGuard] as const
        export const sharedMetadata = { source: 'brand', owner: 'editorial' }
      `,
    )
    await writeFile(
      join(root, 'src/authoring.ts'),
      `
        import { injectable } from '@crux/core'
        import { baseConstraints, extraConstraints, guardrails, sharedMetadata } from './safety'

        export const safetyInjection = injectable({
          id: 'safety-injection',
          inject: async () => ({
            constraints: [...baseConstraints, ...extraConstraints],
            guardrails,
            metadata: { ...sharedMetadata, mode: 'strict' },
          }),
        })
      `,
    )

    const facts = semanticDefinitionEnrichmentIndexFacts(root, [
      join(root, 'src/authoring.ts'),
      join(root, 'src/safety.ts'),
    ])

    expect(facts.definitions).toContainEqual(
      expect.objectContaining({
        id: 'injectable:safety-injection',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            contributions: expect.objectContaining({
              constraints: expect.objectContaining({
                variables: expect.arrayContaining(['safeTone', 'factuality']),
              }),
              guardrails: expect.objectContaining({
                variables: expect.arrayContaining(['outputGuard', 'piiGuard']),
              }),
              metadata: expect.objectContaining({
                keys: expect.arrayContaining(['source', 'owner', 'mode']),
                dynamic: true,
              }),
            }),
          }),
        }),
      }),
    )
  }, 15_000)

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
  }, 15_000)
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
