import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectDefinitionKind } from '@crux/core/project-index'
import { indexProject, indexProjectAst, indexProjectSemantic, resolveProjectModel } from '../index'
import { applyIndexPatch, emptyIndexPatchState } from '../indexer/patches'
import { planIndexFiles } from '../indexer/incremental'
import { staticDefinitionFiles } from '../indexer/files'
import { facts, type IndexerExtension } from '../indexer/extensions'
import { createStaticExtraction } from '../indexer/static/extraction/engine'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const importSafeDiscoveryTimeoutMs = 15_000

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-index-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project indexer', () => {
  it('resolves a no-config Project Model from source and filesystem conventions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'evals'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/no-config-model' }))
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer.prompt',
          system: 'You are a concise writer.',
          prompt: 'Draft the brief.',
        })
      `,
    )
    await writeFile(
      join(root, 'evals/writer.eval.ts'),
      `
        import { evaluate } from '@crux/core/quality'

        export const writerEval = evaluate('writer-eval', {
          task: (input: { topic: string }) => input.topic,
          data: [],
        })
      `,
    )

    const model = await resolveProjectModel({ root })

    expect(model.root).toMatchObject({
      value: root,
      provenance: expect.objectContaining({ kind: 'filesystem' }),
    })
    expect(model.packageName).toMatchObject({
      value: '@fixture/no-config-model',
      provenance: expect.objectContaining({ kind: 'filesystem' }),
    })
    expect(model.configFiles).toContainEqual(
      expect.objectContaining({
        status: expect.objectContaining({ value: 'missing' }),
      }),
    )
    expect(model.ignoredPaths.map((entry) => entry.value)).toContain('**/node_modules/**')
    expect(model.quality).toMatchObject({
      id: expect.objectContaining({ value: '@fixture/no-config-model' }),
      persistenceRoot: expect.objectContaining({ value: join(root, '.crux/quality') }),
      includeGlobs: [
        expect.objectContaining({ value: 'evals/**/*.eval.ts' }),
        expect.objectContaining({ value: '**/*.eval.ts' }),
      ],
    })
    expect(model.quality.evaluationFiles.map((entry) => entry.value)).toContain(join(root, 'evals/writer.eval.ts'))
    expect(model.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prompt:writer.prompt', kind: 'prompt' }),
        expect.objectContaining({ id: 'evaluation:writer-eval', kind: 'evaluation' }),
      ]),
    )
    expect(model.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'project_model.source_only_discovery',
        severity: 'info',
        message: expect.stringContaining('source discovery only'),
      }),
    )
  })

  it('reports no-config indexing as source-only discovery instead of missing primitive registration', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer.prompt',
          system: 'You are a concise writer.',
          prompt: 'Draft the brief.',
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'source-only-diagnostics' })
    const diagnostic = snapshot.diagnostics.find((entry) => entry.code === 'index.config_not_found')

    expect(diagnostic).toEqual(
      expect.objectContaining({
        severity: 'info',
        message: expect.stringContaining('source discovery only'),
        suggestedFix: expect.stringContaining('explicit policy'),
      }),
    )
    expect(diagnostic?.suggestedFix).not.toMatch(/required|prompt|context|tool|primitive|registry/i)
  })

  it('surfaces missing stable routing ids as Project Model diagnostics with source provenance', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'routing.ts'),
      `
        import { router } from '@crux/core/routing'

        export const badRouter = router({
          classify: () => 'cheap',
          routes: {
            cheap: missingModel,
          },
        })
      `,
    )

    const model = await resolveProjectModel({ root, projectName: 'routing-diagnostics', staticOnly: true })

    expect(model.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'project_model.missing_stable_id',
        severity: 'info',
        message: expect.stringContaining('stable id'),
        source: expect.objectContaining({ file: join(root, 'routing.ts') }),
        suggestedFix: expect.stringContaining('stable id'),
        provenance: expect.objectContaining({ kind: 'source', file: join(root, 'routing.ts') }),
        details: expect.objectContaining({
          ruleId: 'routing.missing_stable_id',
          relatedDefinitionIds: expect.arrayContaining(['routing.router:badRouter']),
        }),
      }),
    )
  })

  it('surfaces runtime-dependent tool maps as Project Model diagnostics with source provenance', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'dynamic-tools.ts'),
      `
        import { context, prompt, tool } from '@crux/core'
        import { z } from 'zod'

        const searchDocs = tool({
          name: 'searchDocs',
          description: 'Search docs',
          input: z.object({ query: z.string() }),
          execute: async () => [],
        })

        function createTools(mode?: string) {
          return mode ? {} : { searchDocs }
        }

        export const runtimeTools = context({
          id: 'runtime-tools',
          system: '',
          tools: createTools(process.env.MODE),
        })

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
          use: [runtimeTools],
        })
      `,
    )

    const model = await resolveProjectModel({ root, projectName: 'dynamic-tool-diagnostics', staticOnly: true })

    expect(model.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'project_model.dynamic_tool_map_unproven',
        severity: 'info',
        message: expect.stringContaining('runtime-dependent tools'),
        source: expect.objectContaining({ file: join(root, 'dynamic-tools.ts') }),
        suggestedFix: expect.stringContaining('stable tool names'),
        provenance: expect.objectContaining({ kind: 'source', file: join(root, 'dynamic-tools.ts') }),
        details: expect.objectContaining({
          ruleId: 'injection.dynamic_tools',
          relatedDefinitionIds: expect.arrayContaining(['prompt:writer', 'context:runtime-tools']),
        }),
      }),
    )
  })

  it('keeps generated and bundled artifacts out of the static source scan', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'embedded'), { recursive: true })

    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'
        export default config({})
      `,
    )
    await writeFile(
      join(root, 'embedded/project-indexer.mjs'),
      [
        'var __defProp = Object.defineProperty;',
        'var __commonJS = (cb, mod) => function __require() { return mod || cb((mod = { exports: {} }).exports, mod), mod.exports; };',
        '// node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js',
        'export function bundled() { return "prompt({ id: \\"from-bundle\\" })" }',
      ].join('\n'),
    )
    await writeFile(join(root, 'src/pdfExportWasm.ts'), `export const pdfExportWasm = "${'A'.repeat(1_200_000)}";`)

    const files = staticDefinitionFiles(root)

    expect(files).toContain(join(root, 'src/writer.ts'))
    expect(files).toContain(join(root, 'crux.config.ts'))
    expect(files).not.toContain(join(root, 'embedded/project-indexer.mjs'))
    expect(files).not.toContain(join(root, 'src/pdfExportWasm.ts'))
  })

  it('reports oversized authored-looking source instead of silently skipping it', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/huge-authored.ts'),
      `
        import { prompt } from '@crux/core'

        export const huge = prompt({
          id: 'huge-authored',
          system: 'Large but authored.',
          prompt: 'Draft.',
        })

        export const filler = "${'x'.repeat(1_200_000)}"
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })

    expect(snapshot.definitions.some((definition) => definition.id === 'prompt:huge-authored')).toBe(false)
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.source_too_large',
        severity: 'warning',
        source: expect.objectContaining({ file: join(root, 'src/huge-authored.ts') }),
      }),
    )
  })

  it('can return an AST patch envelope for the existing snapshot path', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config, prompt } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer.prompt',
          system: 'You are a writer.',
          prompt: 'Draft.',
        })

        export default config({ prompts: [writerPrompt] })
      `,
    )

    const patch = await indexProjectAst({ root, projectName: 'fixture', staticOnly: true })

    expect(patch).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        phase: 'ast',
        project: expect.objectContaining({ root, name: 'fixture' }),
        status: 'ok',
        invalidates: { all: true },
      }),
    )
    expect(patch.facts.definitions).toContainEqual(
      expect.objectContaining({ id: 'prompt:writer.prompt', kind: 'prompt' }),
    )
  })

  it('keeps the AST patch path source-only and never imports user config modules', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config, prompt } from '@crux/core'

        throw new Error('this config must not execute during AST indexing')

        export const writerPrompt = prompt({
          id: 'writer.prompt',
          system: 'You are a writer.',
          prompt: 'Draft.',
        })

        export default config({ prompts: [writerPrompt] })
      `,
    )

    const patch = await indexProjectAst({ root, projectName: 'fixture' })

    expect(patch.facts.definitions).toContainEqual(
      expect.objectContaining({ id: 'prompt:writer.prompt', kind: 'prompt', fidelity: 'resolved' }),
    )
    expect(patch.facts.diagnostics).toContainEqual(expect.objectContaining({ code: 'index.static_only' }))
    expect(patch.facts.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'index.config_import_failed' }))
  })

  it('can return a no-op semantic patch that preserves AST index facts', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config, prompt } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer.prompt',
          system: 'You are a writer.',
          prompt: 'Draft.',
        })

        export default config({ prompts: [writerPrompt] })
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'fixture', staticOnly: true })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture' })
    const semanticState = applyIndexPatch(astState, semanticPatch)

    expect(semanticPatch).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        phase: 'semantic',
        project: expect.objectContaining({ root, name: 'fixture' }),
        status: 'ok',
      }),
    )
    expect(semanticPatch.invalidates).toBeUndefined()
    expect(semanticState.definitions.map((definition) => definition.id)).toEqual(
      astState.definitions.map((definition) => definition.id),
    )
  }, 10_000)

  it('degrades semantic indexing when the worker patch exceeds its budget', async () => {
    const root = await fixtureRoot()

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture', semanticBudget: { maxBytes: 1 } })

    expect(semanticPatch.status).toBe('degraded')
    expect(semanticPatch.facts).toEqual({
      diagnostics: [
        expect.objectContaining({
          code: 'index.semantic_budget_exceeded',
          severity: 'info',
        }),
      ],
    })
  })

  it('degrades semantic indexing before enrichment when the project exceeds the semantic file budget', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/one.ts'),
      `import { prompt } from '@crux/core'; export const one = prompt({ id: 'one' })`,
    )
    await writeFile(
      join(root, 'src/two.ts'),
      `import { prompt } from '@crux/core'; export const two = prompt({ id: 'two' })`,
    )

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture', semanticBudget: { maxFiles: 1 } })

    expect(semanticPatch.status).toBe('degraded')
    expect(semanticPatch.facts.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.semantic_budget_exceeded',
        message: expect.stringContaining('files'),
      }),
    )
  })

  it('semantically resolves a tool schema through a renamed barrel export', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'

        export const writerSchema = z.object({
          topic: z.string().describe('Topic to write about'),
        })
      `,
    )
    await writeFile(join(root, 'src/index.ts'), `export { writerSchema as schema } from './schema'`)
    await writeFile(
      join(root, 'src/tool.ts'),
      `
        import { createTool, tool } from '@crux/core'
        import { schema } from './index'

        export const writerTool = tool({
          name: 'writer',
          description: 'Write a draft',
          parameters: schema,
          execute: async () => 'ok',
        })
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'fixture' })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    const astDefinition = astState.definitions.find((definition) => definition.id === 'tool:writer')
    expect(astDefinition).toBeDefined()
    expect(astDefinition?.metadata?.inputSchema).toBeUndefined()
    expect(astDefinition?.sourceRefs ?? []).not.toContainEqual(
      expect.objectContaining({ role: 'schema', property: 'parameters', symbol: 'writerSchema' }),
    )

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture' })
    const semanticState = applyIndexPatch(astState, semanticPatch)
    const semanticDefinition = semanticState.definitions.find((definition) => definition.id === 'tool:writer')

    expect(semanticPatch.status).toBe('ok')
    expect(semanticDefinition?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          topic: expect.objectContaining({ type: 'string', description: 'Topic to write about' }),
        }),
      }),
    )
    expect(semanticDefinition?.sourceRefs).toContainEqual(
      expect.objectContaining({
        role: 'schema',
        property: 'parameters',
        symbol: 'writerSchema',
        fidelity: 'resolved',
        source: expect.objectContaining({ file: join(root, 'src/schema.ts') }),
        metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true }),
      }),
    )
  })

  it('treats tool input schemas as inspectable contracts', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'

        export const recallEpisodesInputSchema = z.object({
          action: z.enum(['record', 'recall', 'list']),
          content: z.string().optional(),
          query: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
      `,
    )
    await writeFile(
      join(root, 'src/tool.ts'),
      `
        import { tool } from '@crux/core'
        import { recallEpisodesInputSchema } from './schema'

        export const recallEpisodes = tool({
          name: 'recallEpisodes',
          description: 'Review recent past user interactions.',
          input: recallEpisodesInputSchema,
          execute: async () => 'ok',
        })

        export const updateContent = createTool({
          description: 'Update an existing post title or content.',
          inputSchema: z.object({
            postId: z.string().describe('Post ID to update'),
            postType: z.string().describe('Content type slug'),
            title: z.string().optional().describe('New title'),
            content: z.string().optional().describe('New content'),
          }),
          execute: async () => 'ok',
        })
      `,
    )

    const snapshot = await indexProject({ root })
    const definition = snapshot.definitions.find((item) => item.id === 'tool:recallEpisodes')
    const inputSchemaDefinition = snapshot.definitions.find((item) => item.id === 'tool:updateContent')

    expect(definition?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          action: expect.objectContaining({ enum: ['record', 'recall', 'list'] }),
          content: expect.objectContaining({ type: 'string' }),
          query: expect.objectContaining({ type: 'string' }),
          metadata: expect.any(Object),
        }),
      }),
    )
    expect(definition?.metadata?.intelligence).toEqual(
      expect.objectContaining({
        contract: expect.objectContaining({
          inputSchema: expect.objectContaining({ type: 'object' }),
        }),
      }),
    )
    expect(definition?.sourceRefs).toContainEqual(
      expect.objectContaining({
        role: 'schema',
        property: 'input',
        symbol: 'recallEpisodesInputSchema',
        fidelity: 'resolved',
        source: expect.objectContaining({ file: join(root, 'src/schema.ts') }),
        metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true }),
      }),
    )
    expect(inputSchemaDefinition?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          postId: expect.objectContaining({ type: 'string', description: 'Post ID to update' }),
          postType: expect.objectContaining({ type: 'string', description: 'Content type slug' }),
          title: expect.objectContaining({ type: 'string' }),
          content: expect.objectContaining({ type: 'string' }),
        }),
      }),
    )
    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'tool.missing_input_schema',
          primaryDefinitionId: 'tool:recallEpisodes',
        }),
        expect.objectContaining({
          ruleId: 'tool.missing_input_schema',
          primaryDefinitionId: 'tool:updateContent',
        }),
      ]),
    )
  })

  it('semantically resolves prompt, context, schema, and agent config refs through renamed barrels', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema-fragments.ts'),
      `
        import { z } from 'zod'

        export const NestedSchema = z.object({
          url: z.string().describe('Source URL'),
        })
      `,
    )
    await writeFile(
      join(root, 'src/shared.ts'),
      `
        import { tool } from '@crux/core'
        import { z } from 'zod'
        import { NestedSchema } from './schema-fragments'

        export { NestedSchema }
        export const WriterSchema = z.object({
          topic: z.string().describe('Topic to write about'),
          source: NestedSchema.optional(),
          drafts: z.array(NestedSchema).optional(),
        })
        export const WRITER_SYSTEM = 'Write with care.'
        export const FORMAT = {
          supported: 'Use lists and tables where useful.',
        }

        export function renderPrompt() {
          return 'Draft the article.'
        }

        export function usageHandler() {
          return undefined
        }

        export const searchDocs = tool({
          name: 'searchDocs',
          parameters: z.object({ query: z.string() }),
          execute: async () => [],
        })
        export const coreTools = { searchDocs }
        export const sharedTools = { ...coreTools, searchDocs }
      `,
    )
    await writeFile(
      join(root, 'src/barrel.ts'),
      `
        export {
          FORMAT as FORMAT_GUIDE,
          NestedSchema as StepSchema,
          WRITER_SYSTEM as SYSTEM,
          WriterSchema as schema,
          renderPrompt as promptBody,
          sharedTools as tools,
          usageHandler as usage,
        } from './shared'
      `,
    )
    await writeFile(
      join(root, 'src/app.ts'),
      `
        import { Agent } from '@convex-dev/agent'
        import { context, prompt } from '@crux/core'
        import { FORMAT_GUIDE, SYSTEM, promptBody, schema, tools, usage } from './barrel'

        export const writer = prompt({
          id: 'writer',
          input: schema,
          system: SYSTEM,
          prompt: promptBody,
        })

        export const formatting = context({
          id: 'formatting',
          system: \`Formatting guidance:\\n\${FORMAT_GUIDE.supported}\`,
        })

        const component = {} as never

        export function createAgent() {
          return new Agent(component, {
            name: 'Karyla',
            tools,
            usageHandler: usage,
          })
        }
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'fixture' })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    const astWriter = astState.definitions.find((definition) => definition.id === 'prompt:writer')
    const astContext = astState.definitions.find((definition) => definition.id === 'context:formatting')
    const astAgent = astState.definitions.find((definition) => definition.id === 'agent:Karyla')

    expect(astWriter).toBeDefined()
    expect(astWriter?.metadata?.inputSchema).toBeUndefined()
    expect(astWriter?.sourceRefs ?? []).not.toContainEqual(
      expect.objectContaining({ role: 'system', symbol: 'WRITER_SYSTEM' }),
    )
    expect(astContext?.sourceRefs ?? []).not.toContainEqual(
      expect.objectContaining({ role: 'system', symbol: 'FORMAT_GUIDE.supported' }),
    )
    expect(astAgent?.sourceRefs ?? []).not.toContainEqual(
      expect.objectContaining({ role: 'config', symbol: 'sharedTools' }),
    )

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture' })
    const semanticState = applyIndexPatch(astState, semanticPatch)
    const writer = semanticState.definitions.find((definition) => definition.id === 'prompt:writer')
    const formatting = semanticState.definitions.find((definition) => definition.id === 'context:formatting')
    const agent = semanticState.definitions.find((definition) => definition.id === 'agent:Karyla')

    expect(semanticPatch.status).toBe('ok')
    expect(writer?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          topic: expect.objectContaining({ type: 'string', description: 'Topic to write about' }),
          source: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              url: expect.objectContaining({ type: 'string', description: 'Source URL' }),
            }),
          }),
          drafts: expect.objectContaining({
            type: 'array',
            items: expect.objectContaining({
              type: 'object',
              properties: expect.objectContaining({
                url: expect.objectContaining({ type: 'string', description: 'Source URL' }),
              }),
            }),
          }),
        }),
      }),
    )
    expect(writer?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'schema',
          property: 'input',
          symbol: 'WriterSchema',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts') }),
          metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true }),
        }),
        expect.objectContaining({
          role: 'schema',
          property: 'input',
          symbol: 'NestedSchema',
          source: expect.objectContaining({ file: join(root, 'src/schema-fragments.ts') }),
          metadata: expect.objectContaining({ nested: true, parsedSchema: true }),
        }),
        expect.objectContaining({
          role: 'system',
          property: 'system',
          symbol: 'WRITER_SYSTEM',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts') }),
          metadata: expect.objectContaining({ fragment: true }),
        }),
        expect.objectContaining({
          role: 'prompt',
          property: 'prompt',
          symbol: 'renderPrompt',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts'), function: 'renderPrompt' }),
        }),
      ]),
    )
    expect(writer?.sourceRefs ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'schema', property: 'input', symbol: 'topic' }),
        expect.objectContaining({ role: 'schema', property: 'input', symbol: 'source' }),
      ]),
    )
    expect(formatting?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          property: 'system',
          symbol: 'FORMAT_GUIDE.supported',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts') }),
          metadata: expect.objectContaining({ injected: true, fragment: true }),
        }),
      ]),
    )
    expect(agent?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'sharedTools',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts') }),
        }),
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'coreTools',
          metadata: expect.objectContaining({ toolMapContributor: 'spread' }),
        }),
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'searchDocs',
          metadata: expect.objectContaining({ toolMapContributor: 'property' }),
        }),
        expect.objectContaining({
          role: 'callback',
          property: 'usageHandler',
          symbol: 'usageHandler',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts'), function: 'usageHandler' }),
        }),
      ]),
    )
  })

  it('semantically enriches primitive relations through renamed barrels', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/targets.ts'),
      `
        import { agent, prompt, tool } from '@crux/core'
        import { z } from 'zod'

        export const writerPrompt = prompt({
          id: 'writer',
          input: z.object({ topic: z.string() }),
          system: 'Write clearly.',
        })

        export const searchDocs = tool({
          name: 'searchDocs',
          parameters: z.object({ query: z.string() }),
          execute: async () => [],
        })

        export const writerAgent = agent({
          id: 'writer-agent',
          prompt: writerPrompt,
          tools: [searchDocs],
        })
      `,
    )
    await writeFile(
      join(root, 'src/barrel.ts'),
      `
        export {
          writerPrompt as agentPrompt,
          searchDocs as searchTool,
          writerAgent as importedAgent,
        } from './targets'
      `,
    )
    await writeFile(
      join(root, 'src/app.ts'),
      `
        import { Agent } from '@convex-dev/agent'
        import { flow, guardrail, parallel, pipeline } from '@crux/core'
        import { agentPrompt, importedAgent, searchTool } from './barrel'

        const component = {} as never
        const tools = { searchTool }

        export function createAgent() {
          return new Agent(component, {
            name: 'Karyla',
            prompt: agentPrompt,
            tools,
          })
        }

        export const writerFlow = flow({
          name: 'writer-flow',
          handler: async (flow) => {
            await flow.step('draft', importedAgent)
            await flow.step('outline', agentPrompt)
            await flow.step('search', searchTool)
          },
        })

        export const writerParallel = parallel({
          agents: {
            draft: importedAgent,
            outline: agentPrompt,
            search: searchTool,
          },
        })

        export const writerPipeline = pipeline({
          steps: [
            { name: 'draft', agent: importedAgent },
            { name: 'outline', prompt: agentPrompt },
            { name: 'search', tool: searchTool },
            { name: 'flow', flow: writerFlow },
          ],
        })

        export const outputGuard = guardrail({
          name: 'output-guard',
          appliesTo: [importedAgent, agentPrompt, searchTool],
        })
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'fixture' })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    expect(astState.relations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:Karyla', to: 'tool:searchDocs' }),
        expect.objectContaining({
          type: 'flow.step.uses_tool',
          from: 'flow.step:writer-flow:search',
          to: 'tool:searchDocs',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_prompt',
          from: 'composition.pipeline:writerPipeline:stage:outline',
          to: 'prompt:writer',
        }),
      ]),
    )

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture' })
    const semanticState = applyIndexPatch(astState, semanticPatch)

    expect(semanticPatch.status).toBe('ok')
    expect(semanticPatch.facts.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.uses_prompt',
          from: 'agent:Karyla',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'agent.uses_tool',
          from: 'agent:Karyla',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_agent',
          from: 'flow.step:writer-flow:draft',
          to: 'agent:writer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_prompt',
          from: 'flow.step:writer-flow:outline',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_tool',
          from: 'flow.step:writer-flow:search',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.parallel:writerParallel',
          to: 'agent:writer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'parallel.branch.uses_prompt',
          from: 'composition.parallel:writerParallel:branch:outline',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'parallel.branch.uses_tool',
          from: 'composition.parallel:writerParallel:branch:search',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_agent',
          from: 'composition.pipeline:writerPipeline:stage:draft',
          to: 'agent:writer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_prompt',
          from: 'composition.pipeline:writerPipeline:stage:outline',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_tool',
          from: 'composition.pipeline:writerPipeline:stage:search',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_flow',
          from: 'composition.pipeline:writerPipeline:stage:flow',
          to: 'flow:writer-flow',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'guardrail.applies_to',
          from: 'guardrail:output-guard',
          to: 'agent:writer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'guardrail.applies_to',
          from: 'guardrail:output-guard',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'guardrail.applies_to',
          from: 'guardrail:output-guard',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
      ]),
    )
    expect(semanticState.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.uses_tool',
          from: 'agent:Karyla',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_flow',
          from: 'composition.pipeline:writerPipeline:stage:flow',
          to: 'flow:writer-flow',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'guardrail.applies_to',
          from: 'guardrail:output-guard',
          to: 'tool:searchDocs',
          fidelity: 'resolved',
        }),
      ]),
    )
  }, 10_000)

  it('semantically enriches primitive contracts through renamed barrels', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/contracts.ts'),
      `
        import { z } from 'zod'

        export const FlowArgs = z.object({
          query: z.string().describe('Question to research'),
        })
        export const ToolParams = z.object({
          query: z.string(),
        })
        export const ToolResult = z.object({
          title: z.string(),
          url: z.string().optional(),
        })
        export const MemoryState = z.object({
          turnCount: z.number(),
        })
        export const workspaceMounts = [
          { path: '/drafts', access: 'readwrite', description: 'Draft files' },
        ]
      `,
    )
    await writeFile(
      join(root, 'src/barrel.ts'),
      `
        export {
          FlowArgs as args,
          ToolParams as params,
          ToolResult as result,
          MemoryState as stateSchema,
          workspaceMounts as mounts,
        } from './contracts'
      `,
    )
    await writeFile(
      join(root, 'src/app.ts'),
      `
        import { flow, tool, workspace } from '@crux/core'
        import { memory, workingState } from '@crux/core/memory'
        import { args, mounts, params, result, stateSchema } from './barrel'

        export const writerTool = tool({
          name: 'writerTool',
          parameters: params,
          output: result,
          execute: async () => ({ title: 'done' }),
        })

        export const writerFlow = flow({
          name: 'writer-flow',
          args,
          handler: async () => undefined,
        })

        const sessionState = workingState({ id: 'state', schema: stateSchema })
        export const sessionMemory = memory({ id: 'session-memory', blocks: [sessionState] })

        export const scratch = workspace({
          id: 'scratch',
          mounts,
        })
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'fixture' })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    expect(
      astState.definitions.find((definition) => definition.id === 'flow:writer-flow')?.metadata?.argsSchema,
    ).toBeUndefined()
    expect(
      astState.definitions.find((definition) => definition.id === 'tool:writerTool')?.metadata?.outputSchema,
    ).toBeUndefined()
    expect(
      astState.definitions.find((definition) => definition.id === 'memory.block:session-memory:state')?.metadata
        ?.schema,
    ).toBeUndefined()
    expect(
      astState.definitions.find((definition) => definition.id === 'workspace:scratch')?.metadata?.mounts,
    ).toBeUndefined()

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture' })
    const semanticState = applyIndexPatch(astState, semanticPatch)
    const flowDefinition = semanticState.definitions.find((definition) => definition.id === 'flow:writer-flow')
    const toolDefinition = semanticState.definitions.find((definition) => definition.id === 'tool:writerTool')
    const memoryDefinition = semanticState.definitions.find((definition) => definition.id === 'memory:session-memory')
    const blockDefinition = semanticState.definitions.find(
      (definition) => definition.id === 'memory.block:session-memory:state',
    )
    const workspaceDefinition = semanticState.definitions.find((definition) => definition.id === 'workspace:scratch')

    expect(semanticPatch.status).toBe('ok')
    expect(flowDefinition?.metadata?.argsSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          query: expect.objectContaining({ type: 'string', description: 'Question to research' }),
        }),
      }),
    )
    expect(toolDefinition?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ query: expect.objectContaining({ type: 'string' }) }),
      }),
    )
    expect(toolDefinition?.metadata?.outputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          title: expect.objectContaining({ type: 'string' }),
          url: expect.objectContaining({ type: 'string' }),
        }),
      }),
    )
    expect(blockDefinition?.metadata?.schema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ turnCount: expect.objectContaining({ type: 'number' }) }),
      }),
    )
    expect(memoryDefinition?.metadata?.schema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ turnCount: expect.objectContaining({ type: 'number' }) }),
      }),
    )
    expect(memoryDefinition?.metadata?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'state',
          kind: 'working',
          schema: expect.objectContaining({
            properties: expect.objectContaining({ turnCount: expect.objectContaining({ type: 'number' }) }),
          }),
        }),
      ]),
    )
    expect(workspaceDefinition?.metadata?.mounts).toEqual([
      expect.objectContaining({ path: '/drafts', access: 'readwrite', description: 'Draft files' }),
    ])
    expect(flowDefinition?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'schema',
          property: 'args',
          symbol: 'FlowArgs',
          source: expect.objectContaining({ file: join(root, 'src/contracts.ts') }),
        }),
      ]),
    )
  })

  it('semantically maps data access through renamed-barrel helpers', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/resources.ts'),
      `
        import { workspace } from '@crux/core'
        import { blackboard } from '@crux/core/agent'
        import { evaluate } from '@crux/core/quality'
        import { memory, workingState } from '@crux/core/memory'
        import { retriever } from '@crux/core/retrieval'
        import { llmJudge } from '@crux/core/scoring'
        import { z } from 'zod'

        const state = workingState({ id: 'state', schema: z.object({ status: z.string().optional() }) })
        export const sessionMemory = memory({ id: 'session-memory', blocks: [state] })
        export const notes = blackboard({ id: 'notes', schema: z.object({ status: z.string().optional() }) })
        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
        export const docsRetriever = retriever({ id: 'docs', retrieve: async () => [] })
        export const factuality = llmJudge({ id: 'factuality', criteria: 'Factual', scale: { min: 0, max: 1 } })
        export const writerEval = evaluate('writer-eval', { task: (input: { draft: string }) => input.draft, data: [] })
      `,
    )
    await writeFile(
      join(root, 'src/helpers.ts'),
      `
        import { docsRetriever, factuality, notes, scratch, sessionMemory, writerEval } from './resources'

        export async function hydrateDraft() {
          await sessionMemory.read('profile')
          await notes.write('status', 'ready')
          await scratch.writeFile('/draft.md', 'done')
          await docsRetriever.retrieve('query')
          await factuality.score({ answer: 'done' })
          await writerEval.run({ input: 'draft' })
        }
      `,
    )
    await writeFile(join(root, 'src/barrel.ts'), `export { hydrateDraft as runDraftAccess } from './helpers'`)
    await writeFile(
      join(root, 'src/app.ts'),
      `
        import { flow, tool } from '@crux/core'
        import { runDraftAccess } from './barrel'

        export const writerTool = tool({
          name: 'writerTool',
          execute: runDraftAccess,
        })

        export const writerFlow = flow({
          name: 'writer-flow',
          handler: async (flow) => {
            await flow.step('hydrate', runDraftAccess)
          },
        })
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'fixture' })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    expect(astState.relations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool.reads_memory', from: 'tool:writerTool', to: 'memory:session-memory' }),
        expect.objectContaining({
          type: 'flow.step.writes_workspace',
          from: 'flow.step:writer-flow:hydrate',
          to: 'workspace:scratch',
        }),
      ]),
    )

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'fixture' })
    const semanticState = applyIndexPatch(astState, semanticPatch)

    expect(semanticPatch.status).toBe('ok')
    expect(semanticState.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool.reads_memory',
          from: 'tool:writerTool',
          to: 'memory:session-memory',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'tool.writes_blackboard',
          from: 'tool:writerTool',
          to: 'blackboard:notes',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'tool.writes_workspace',
          from: 'tool:writerTool',
          to: 'workspace:scratch',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'tool.queries_retriever',
          from: 'tool:writerTool',
          to: 'rag.retriever:docs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'tool.uses_scorer',
          from: 'tool:writerTool',
          to: 'scorer:factuality',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'tool.runs_eval',
          from: 'tool:writerTool',
          to: 'evaluation:writer-eval',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.reads_memory',
          from: 'flow.step:writer-flow:hydrate',
          to: 'memory:session-memory',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.writes_blackboard',
          from: 'flow.step:writer-flow:hydrate',
          to: 'blackboard:notes',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.writes_workspace',
          from: 'flow.step:writer-flow:hydrate',
          to: 'workspace:scratch',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.queries_retriever',
          from: 'flow.step:writer-flow:hydrate',
          to: 'rag.retriever:docs',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_scorer',
          from: 'flow.step:writer-flow:hydrate',
          to: 'scorer:factuality',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.runs_eval',
          from: 'flow.step:writer-flow:hydrate',
          to: 'evaluation:writer-eval',
          fidelity: 'resolved',
        }),
      ]),
    )
  })

  it('emits state-resource lints when semantic writes have no visible read path', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/resources.ts'),
      `
        import { workspace } from '@crux/core'
        import { blackboard } from '@crux/core/agent'
        import { memory, workingState } from '@crux/core/memory'
        import { z } from 'zod'

        const writeOnlyState = workingState({ id: 'state', schema: z.object({ draft: z.string().optional() }) })
        const readBackState = workingState({ id: 'state', schema: z.object({ draft: z.string().optional() }) })

        export const writeOnlyMemory = memory({ id: 'write-only-memory', blocks: [writeOnlyState] })
        export const readBackMemory = memory({ id: 'read-back-memory', blocks: [readBackState] })
        export const notes = blackboard({ id: 'notes', schema: z.object({ decision: z.string().optional() }) })
        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
      `,
    )
    await writeFile(
      join(root, 'src/helpers.ts'),
      `
        import { notes, readBackMemory, scratch, writeOnlyMemory } from './resources'

        export async function persistWithoutRead() {
          await writeOnlyMemory.write('draft', 'done')
          await notes.update('decision', 'publish')
          await scratch.writeFile('/drafts/article.md', 'done')
        }

        export async function persistAndReadBack() {
          await readBackMemory.write('draft', 'done')
          return readBackMemory.read('draft')
        }
      `,
    )
    await writeFile(join(root, 'src/barrel.ts'), `export { persistAndReadBack, persistWithoutRead } from './helpers'`)
    await writeFile(
      join(root, 'src/tools.ts'),
      `
        import { tool } from '@crux/core'
        import { z } from 'zod'
        import { persistAndReadBack, persistWithoutRead } from './barrel'

        export const persistTool = tool({
          name: 'persistTool',
          parameters: z.object({ draft: z.string() }),
          execute: persistWithoutRead,
        })

        export const readBackTool = tool({
          name: 'readBackTool',
          parameters: z.object({ draft: z.string() }),
          execute: persistAndReadBack,
        })
      `,
    )

    const astPatch = await indexProjectAst({ root, projectName: 'state-resource-lints' })
    const astState = applyIndexPatch(emptyIndexPatchState(), astPatch)
    expect(astState.relations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool.writes_memory',
          from: 'tool:persistTool',
          to: 'memory:write-only-memory',
        }),
      ]),
    )

    const semanticPatch = await indexProjectSemantic({ root, projectName: 'state-resource-lints' })
    const semanticState = applyIndexPatch(astState, semanticPatch)

    expect(semanticState.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool.writes_memory',
          from: 'tool:persistTool',
          to: 'memory:write-only-memory',
        }),
        expect.objectContaining({ type: 'tool.writes_blackboard', from: 'tool:persistTool', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'tool.writes_workspace', from: 'tool:persistTool', to: 'workspace:scratch' }),
        expect.objectContaining({
          type: 'tool.writes_memory',
          from: 'tool:readBackTool',
          to: 'memory:read-back-memory',
        }),
        expect.objectContaining({
          type: 'tool.reads_memory',
          from: 'tool:readBackTool',
          to: 'memory:read-back-memory',
        }),
      ]),
    )
    expect(semanticState.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'resource.write_without_read',
          relatedDefinitionIds: ['memory:write-only-memory'],
          affectedDefinitionIds: expect.arrayContaining(['memory:write-only-memory', 'tool:persistTool']),
          evidence: expect.arrayContaining([
            expect.objectContaining({ kind: 'relation', label: 'Visible write without a matching read' }),
          ]),
        }),
        expect.objectContaining({
          ruleId: 'resource.write_without_read',
          relatedDefinitionIds: ['blackboard:notes'],
        }),
        expect.objectContaining({
          ruleId: 'resource.write_without_read',
          relatedDefinitionIds: ['workspace:scratch'],
        }),
      ]),
    )
    expect(semanticState.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'resource.write_without_read',
          relatedDefinitionIds: ['memory:read-back-memory'],
        }),
      ]),
    )
  })

  it('discovers import-safe prompts, contexts, tools, evals, and suites', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'evals'), { recursive: true })
    await mkdir(join(root, '.crux/quality/suites'), { recursive: true })

    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config, context, prompt } from '@crux/core'
        import { z } from 'zod'

        export const brandVoice = context({
          id: 'brand.voice',
          description: 'Brand voice rules',
          system: 'Use clear prose.',
        })

        export const writerPrompt = prompt({
          id: 'writer.prompt',
          description: 'Draft a short answer',
          tags: ['writing'],
          use: [brandVoice],
          input: z.object({ topic: z.string() }),
          system: 'You are a writer.',
          prompt: ({ input }) => input.topic,
        })

        export default config({
          prompts: [writerPrompt],
          contexts: [brandVoice],
          tools: [
            {
              name: 'searchDocs',
              description: 'Search docs',
              parameters: z.object({ query: z.string() }),
            },
          ],
          quality: {
            include: 'evals/**/*.eval.ts',
          },
        })
      `,
    )

    await writeFile(
      join(root, 'evals/writer.eval.ts'),
      `
        import { evaluate } from '@crux/core/quality'
        import { writerPrompt } from '../crux.config'

        export const writerEval = evaluate('writer-eval', {
          task: writerPrompt,
          data: [{ name: 'draft title', input: { topic: 'Launch' } }],
          expect: (ctx) => {
            ctx.expect(ctx.output).toBeDefined()
          },
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'fixture' })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(snapshot.project).toMatchObject({ root, name: 'fixture', configFile: join(root, 'crux.config.ts') })
    expect(byId.get('prompt:writer.prompt')).toMatchObject({
      kind: 'prompt',
      fidelity: 'resolved',
      name: 'writer.prompt',
    })
    expect(byId.get('context:brand.voice')).toMatchObject({
      kind: 'context',
      fidelity: 'resolved',
      name: 'brand.voice',
    })
    expect(byId.get('tool:searchDocs')).toMatchObject({ kind: 'tool', fidelity: 'resolved', name: 'searchDocs' })
    expect(byId.get('prompt:writer.prompt')?.source).toEqual(
      expect.objectContaining({ file: join(root, 'crux.config.ts'), line: expect.any(Number) }),
    )
    expect(byId.get('context:brand.voice')?.source).toEqual(
      expect.objectContaining({ file: join(root, 'crux.config.ts'), line: expect.any(Number) }),
    )
    expect(byId.get('tool:searchDocs')?.source).toEqual(
      expect.objectContaining({ file: join(root, 'crux.config.ts'), line: expect.any(Number) }),
    )
    expect(byId.get('evaluation:writer-eval')).toMatchObject({
      kind: 'evaluation',
      fidelity: 'resolved',
      name: 'writer-eval',
      metadata: expect.objectContaining({
        taskKind: 'prompt',
        taskRef: 'writer.prompt',
        caseCount: 1,
        assertionSites: [
          expect.objectContaining({
            assertionSiteId: expect.stringMatching(/^assertion-site:[a-f0-9]{16}$/),
            callbackKind: 'expect',
            callbackLevel: 'evaluation',
            sourceRef: expect.stringMatching(/writer\.eval\.ts:\d+:\d+$/),
            normalizedAssertionText: 'ctx.expect(ctx.output).toBeDefined()',
          }),
        ],
        facts: expect.objectContaining({
          kind: 'evaluation',
          taskKind: 'prompt',
          caseCount: 1,
          assertionSites: [
            expect.objectContaining({
              assertionSiteId: expect.stringMatching(/^assertion-site:[a-f0-9]{16}$/),
              callbackKind: 'expect',
              callbackLevel: 'evaluation',
            }),
          ],
        }),
      }),
    })
    expect(byId.get('evaluation.case:writer-eval:draft-title')).toMatchObject({
      kind: 'evaluation.case',
      fidelity: 'resolved',
      name: 'draft title',
      metadata: expect.objectContaining({
        evaluationId: 'writer-eval',
        caseId: 'draft-title',
        facts: expect.objectContaining({ kind: 'evaluation.case', evaluationId: 'writer-eval' }),
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'evaluation:writer-eval',
          parentRelationType: 'evaluation.includes_case',
          role: 'case',
        }),
      }),
    })
    expect(byId.get('prompt:writer.prompt')?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({ type: 'object' }),
        outputSchema: undefined,
        hasOutput: false,
      }),
    )
    expect(byId.get('context:brand.voice')?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: undefined,
        isStatic: true,
      }),
    )
    expect(byId.get('tool:searchDocs')?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({ type: 'object' }),
      }),
    )
    expect(
      snapshot.relations.some(
        (relation) =>
          relation.type === 'prompt.uses_context' &&
          relation.from === 'prompt:writer.prompt' &&
          relation.to === 'context:brand.voice',
      ),
    ).toBe(true)
    expect(
      snapshot.relations.some(
        (relation) =>
          relation.type === 'evaluation.targets_prompt' &&
          relation.from === 'evaluation:writer-eval' &&
          relation.to === 'prompt:writer.prompt',
      ),
    ).toBe(true)
    expect(
      snapshot.relations.some(
        (relation) =>
          relation.type === 'evaluation.includes_case' &&
          relation.from === 'evaluation:writer-eval' &&
          relation.to === 'evaluation.case:writer-eval:draft-title',
      ),
    ).toBe(true)

    const snapshotAgain = await indexProject({ root, projectName: 'fixture' })
    expect(snapshotAgain.definitions.map((definition) => definition.id)).toEqual(
      snapshot.definitions.map((definition) => definition.id),
    )
    expect(snapshotAgain.relations.map((relation) => relation.id)).toEqual(
      snapshot.relations.map((relation) => relation.id),
    )
    expect(snapshotAgain.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(
      snapshot.diagnostics.map((diagnostic) => diagnostic.id),
    )
    expect(snapshotAgain.lintFindings.map((finding) => finding.id)).toEqual(
      snapshot.lintFindings.map((finding) => finding.id),
    )
  }, importSafeDiscoveryTimeoutMs)

  it('falls back to static definitions without noisy partial diagnostics when imports fail', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'broken.prompt.ts'),
      `
        import { context, prompt } from '@crux/core'
        import { z } from 'zod'

        throw new Error('top-level side effect')

        export const staticContext = context({
          id: 'static.context',
          input: z.object({ locale: z.string().optional() }),
          system: 'Static context',
        })

        export const StaticOutput = z.object({
          answer: z.string().describe('Final answer'),
        })

        export const staticPrompt = prompt({
          id: 'static.prompt',
          use: [staticContext],
          input: z.object({
            topic: z.string().max(200),
            count: z.number().optional(),
            tags: z.array(z.string()).max(3),
          }),
          output: StaticOutput,
          system: 'Static system',
          prompt: 'Static prompt',
        })
      `,
    )
    await writeFile(
      join(root, 'broken.eval.ts'),
      `
        import { evaluate } from '@crux/core/quality'

        throw new Error('eval import side effect')

        export const brokenEval = evaluate({
          task: (input: { topic: string }) => input.topic,
          data: [],
        })
      `,
    )

    const snapshot = await indexProject({ root })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('prompt:static.prompt')).toMatchObject({
      kind: 'prompt',
      fidelity: 'resolved',
      name: 'static.prompt',
    })
    expect(byId.get('context:static.context')).toMatchObject({
      kind: 'context',
      fidelity: 'resolved',
      name: 'static.context',
    })
    expect(byId.get('evaluation:brokenEval')).toMatchObject({
      kind: 'evaluation',
      fidelity: 'resolved',
      name: 'brokenEval',
    })
    expect(byId.get('prompt:static.prompt')?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            topic: expect.objectContaining({ type: 'string', maxLength: 200 }),
            count: expect.objectContaining({ type: 'number' }),
            tags: expect.objectContaining({ type: 'array', maxItems: 3 }),
          }),
          required: ['topic', 'tags'],
        }),
        outputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            answer: expect.objectContaining({ type: 'string', description: 'Final answer' }),
          }),
        }),
        hasOutput: true,
      }),
    )
    expect(byId.get('context:static.context')?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({ locale: expect.objectContaining({ type: 'string' }) }),
        }),
        isStatic: false,
      }),
    )
    expect(snapshot.relations).toContainEqual(
      expect.objectContaining({
        type: 'prompt.uses_context',
        from: 'prompt:static.prompt',
        to: 'context:static.context',
        fidelity: 'resolved',
      }),
    )
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'index.config_not_found' }),
        expect.objectContaining({ code: 'index.module_import_failed' }),
      ]),
    )
    expect(snapshot.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'index.static_partial' })]),
    )
    expect(snapshot.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'index.rich_import_failed',
          source: expect.objectContaining({ file: expect.stringContaining('broken.prompt.ts') }),
        }),
      ]),
    )
  })

  it('projects createPrompts and createContexts authored namespaces into definition paths', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'prompts/contexts'), { recursive: true })

    await writeFile(
      join(root, 'prompts/draft.ts'),
      `
        import { prompt } from '@crux/core'

        export const draftEdit = prompt({ id: 'draft-edit', prompt: 'Edit draft' })
        export const seoEdit = prompt({ id: 'seo-edit', prompt: 'SEO edit' })
      `,
    )
    await writeFile(
      join(root, 'prompts/agent.ts'),
      `
        import { prompt } from '@crux/core'

        export const karylaAgent = prompt({ id: 'karyla-agent', prompt: 'Agent system' })
      `,
    )
    await writeFile(
      join(root, 'prompts/contexts/base.ts'),
      `
        import { context } from '@crux/core'

        export const currentDate = context({ id: 'current-date', system: 'Today' })
        export const proseMirrorSchema = context({ id: 'prosemirror-schema', system: 'Schema' })
        export const brand = context({ id: 'brand-context', system: 'Brand' })
      `,
    )
    await writeFile(
      join(root, 'prompts/index.ts'),
      `
        import { createPrompts, createContexts } from '@crux/core'
        import { draftEdit, seoEdit } from './draft'
        import { karylaAgent as systemPrompt } from './agent'
        import { currentDate, proseMirrorSchema, brand } from './contexts/base'

        export const prompts = createPrompts({
          editor: { edit: draftEdit, seo: seoEdit },
          agent: { system: systemPrompt },
        })

        export const contexts = createContexts({
          currentDate,
          editor: { proseMirror: proseMirrorSchema },
          brand: { voice: brand },
        })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('prompt:draft-edit')?.path).toEqual(['editor', 'edit'])
    expect(byId.get('prompt:seo-edit')?.path).toEqual(['editor', 'seo'])
    expect(byId.get('prompt:karyla-agent')?.path).toEqual(['agent', 'system'])
    expect(byId.get('context:current-date')?.path).toEqual(['currentDate'])
    expect(byId.get('context:prosemirror-schema')?.path).toEqual(['editor', 'proseMirror'])
    expect(byId.get('context:brand-context')?.path).toEqual(['brand', 'voice'])
    expect(byId.get('prompt:draft-edit')?.metadata).not.toHaveProperty('path')
    expect(byId.get('context:current-date')?.metadata).not.toHaveProperty('path')
  })

  it('resolves static prompt context relations through imports and use arrays', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/contexts.ts'),
      `
        import { context } from '@crux/core'

        export const currentDate = context({
          id: 'current-date',
          system: () => 'Today',
        })

        export const proseMirrorSchema = context({
          id: 'prosemirror-schema',
          system: 'Schema',
        })
      `,
    )
    await writeFile(
      join(root, 'src/prompts.ts'),
      `
        import { prompt } from '@crux/core'
        import { currentDate, proseMirrorSchema } from './contexts'

        const sharedContexts = [currentDate, proseMirrorSchema]

        export const directPrompt = prompt({
          id: 'direct',
          use: [currentDate],
          prompt: 'Write',
        })

        export const arrayPrompt = prompt({
          id: 'array',
          use: sharedContexts,
          prompt: 'Write',
        })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })

    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'prompt.uses_context', from: 'prompt:direct', to: 'context:current-date' }),
        expect.objectContaining({ type: 'prompt.uses_context', from: 'prompt:array', to: 'context:current-date' }),
        expect.objectContaining({
          type: 'prompt.uses_context',
          from: 'prompt:array',
          to: 'context:prosemirror-schema',
        }),
      ]),
    )
  })

  it('does not invent authored paths for dynamic hierarchy leaves and keeps best-effort Zod metadata', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'index.ts'),
      `
        import { createContexts, createPrompts, context, prompt } from '@crux/core'
        import { z } from 'zod'

        const unknownKey = 'dynamic'
        const AuthoredInput = z.object({
          intent: z.enum(['create', 'edit']).describe('Requested operation'),
          tags: z.array(z.string()).min(1).max(3),
          language: z.string().default('en').optional(),
        })

        export const dynamicPrompt = prompt({
          id: 'dynamic-prompt',
          input: AuthoredInput,
          prompt: 'Dynamic path prompt',
        })
        export const stablePrompt = prompt({ id: 'stable-prompt', prompt: 'Stable path prompt' })
        export const dynamicContext = context({ id: 'dynamic-context', system: 'Dynamic context' })
        export const stableContext = context({ id: 'stable-context', system: 'Stable context' })

        const spreadPrompts = { spread: dynamicPrompt }
        export const prompts = createPrompts({
          ...spreadPrompts,
          [unknownKey]: dynamicPrompt,
          stable: stablePrompt,
        })

        export const contexts = createContexts({
          [unknownKey]: dynamicContext,
          stable: stableContext,
        })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('prompt:stable-prompt')?.path).toEqual(['stable'])
    expect(byId.get('context:stable-context')?.path).toEqual(['stable'])
    expect(byId.get('prompt:dynamic-prompt')?.path).toBeUndefined()
    expect(byId.get('context:dynamic-context')?.path).toBeUndefined()
    expect(byId.get('prompt:dynamic-prompt')?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            intent: expect.objectContaining({ enum: ['create', 'edit'], description: 'Requested operation' }),
            tags: expect.objectContaining({ type: 'array', minItems: 1, maxItems: 3 }),
            language: expect.objectContaining({ type: 'string', default: 'en' }),
          }),
          required: ['intent', 'tags'],
        }),
      }),
    )
  })

  it('resolves tool schema and callback source refs from local variables and direct imports', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })

    await writeFile(
      join(root, 'src/shared.ts'),
      `
        import { z } from 'zod'

        export const importedStepSchema = z.object({
          label: z.string(),
        })

        export const importedWriterSchema = z.object({
          draftId: z.string(),
          tone: z.enum(['plain', 'warm']),
          step: importedStepSchema,
        })

        export async function importedExecute(args: unknown) {
          return args
        }
      `,
    )

    await writeFile(
      join(root, 'src/tools.ts'),
      `
        import { createTool } from '@crux/core/tool'
        import { z } from 'zod'
        import { importedExecute, importedWriterSchema } from './shared'

        const localWriterSchema = z.object({ query: z.string().describe('Search query') })

        async function localExecute(args: unknown) {
          return args
        }

        export const localTool = createTool({
          name: 'localTool',
          description: 'Local tool',
          parameters: localWriterSchema,
          execute: localExecute,
        })

        export const importedTool = createTool({
          name: 'importedTool',
          description: 'Imported tool',
          parameters: importedWriterSchema,
          execute: importedExecute,
        })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))
    const localTool = byId.get('tool:localTool')
    const importedTool = byId.get('tool:importedTool')

    expect(localTool?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            query: expect.objectContaining({ type: 'string', description: 'Search query' }),
          }),
        }),
      }),
    )
    expect(localTool?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'schema',
          property: 'parameters',
          symbol: 'localWriterSchema',
          fidelity: 'resolved',
          source: expect.objectContaining({ file: join(root, 'src/tools.ts'), line: expect.any(Number) }),
          metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true }),
        }),
        expect.objectContaining({
          role: 'execute',
          property: 'execute',
          symbol: 'localExecute',
          fidelity: 'resolved',
          source: expect.objectContaining({
            file: join(root, 'src/tools.ts'),
            line: expect.any(Number),
            function: 'localExecute',
          }),
        }),
      ]),
    )

    expect(importedTool?.metadata).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            draftId: expect.objectContaining({ type: 'string' }),
            tone: expect.objectContaining({ enum: ['plain', 'warm'] }),
          }),
        }),
      }),
    )
    expect(importedTool?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'schema',
          property: 'parameters',
          symbol: 'importedWriterSchema',
          fidelity: 'resolved',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts'), line: expect.any(Number) }),
          metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true }),
        }),
        expect.objectContaining({
          role: 'schema',
          property: 'parameters',
          symbol: 'importedStepSchema',
          fidelity: 'resolved',
          source: expect.objectContaining({ file: join(root, 'src/shared.ts'), line: expect.any(Number) }),
          metadata: expect.objectContaining({ schemaKind: 'zod', parsedSchema: true, nested: true }),
        }),
        expect.objectContaining({
          role: 'execute',
          property: 'execute',
          symbol: 'importedExecute',
          fidelity: 'resolved',
          source: expect.objectContaining({
            file: join(root, 'src/shared.ts'),
            line: expect.any(Number),
            function: 'importedExecute',
          }),
        }),
      ]),
    )

    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'tool.missing_input_schema', primaryDefinitionId: 'tool:localTool' }),
        expect.objectContaining({ ruleId: 'tool.missing_input_schema', primaryDefinitionId: 'tool:importedTool' }),
      ]),
    )
    expect(snapshot.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: join(root, 'src/tools.ts'),
          dependencies: expect.arrayContaining([join(root, 'src/shared.ts')]),
        }),
        expect.objectContaining({
          file: join(root, 'src/shared.ts'),
          dependents: expect.arrayContaining([join(root, 'src/tools.ts')]),
        }),
      ]),
    )
  })

  it('resolves source refs and data access from callback identifiers and one helper level', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })

    await writeFile(
      join(root, 'src/feature.ts'),
      `
        import { context, prompt } from '@crux/core'
        import { flow } from '@crux/core/flow'
        import { blackboard } from '@crux/core/agent/blackboard'
        import { guardrail } from '@crux/core/safety/guardrail'
        import { llmJudge } from '@crux/core/scoring'
        import { createTool } from '@crux/core/tool'
        import { z } from 'zod'

        const notes = blackboard({ id: 'notes' })
        const promptInput = z.object({ draft: z.string() })

        function buildSystem() {
          return 'System'
        }

        const staticSystem = 'Use the static system prompt.'
        const injectedGuidance = 'Injected guidance.'
        const fragments = { extraGuidance: 'Extra guidance.' }

        function buildPrompt() {
          notes.read('prompt')
          return 'Prompt'
        }

        function shouldInclude() {
          notes.read('policy')
          return true
        }

        function policyCheck() {
          return { action: 'allow' }
        }

        function judgeScore() {
          return 1
        }

        async function writePlan(args: unknown) {
          await notes.write('plan', args)
        }

        async function runWriter(args: unknown) {
          await writePlan(args)
          return args
        }

        async function draftStep() {
          await writePlan('draft')
        }

        export const writerPrompt = prompt({
          id: 'writer-prompt',
          input: promptInput,
          system: buildSystem,
          prompt: buildPrompt,
        })

        export const staticPrompt = prompt({
          id: 'static-prompt',
          system: staticSystem,
          prompt: buildPrompt,
        })

        export const activeContext = context({
          id: 'active-context',
          when: shouldInclude,
          system: buildSystem,
        })

        export const staticContext = context({
          id: 'static-context',
          system: \`Static context.\\n\${injectedGuidance}\\n\${fragments.extraGuidance}\`,
        })

        export const writerTool = createTool({
          name: 'writerTool',
          description: 'Writer tool',
          parameters: promptInput,
          execute: runWriter,
        })

        export const safe = guardrail({ name: 'safe', check: policyCheck })
        export const judge = llmJudge({ id: 'judge', score: judgeScore })

        export const writerFlow = flow('writer-flow', async (flow) => {
          await flow.step('draft', draftStep)
        })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))
    const writerPrompt = byId.get('prompt:writer-prompt')
    const staticPrompt = byId.get('prompt:static-prompt')
    const activeContext = byId.get('context:active-context')
    const staticContext = byId.get('context:static-context')
    const writerTool = byId.get('tool:writerTool')
    const safe = byId.get('guardrail:safe')
    const judge = byId.get('scorer:judge')
    const draftStep = byId.get('flow.step:writer-flow:draft')

    expect(writerPrompt?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'schema', property: 'input', symbol: 'promptInput' }),
        expect.objectContaining({ role: 'system', property: 'system', symbol: 'buildSystem' }),
        expect.objectContaining({ role: 'prompt', property: 'prompt', symbol: 'buildPrompt' }),
      ]),
    )
    expect(staticPrompt?.sourceRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'system', property: 'system', symbol: 'staticSystem' })]),
    )
    expect(activeContext?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'policy', property: 'when', symbol: 'shouldInclude' }),
        expect.objectContaining({ role: 'system', property: 'system', symbol: 'buildSystem' }),
      ]),
    )
    expect(staticContext?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          property: 'system',
          symbol: 'injectedGuidance',
          metadata: expect.objectContaining({ injected: true, fragment: true }),
        }),
        expect.objectContaining({
          role: 'system',
          property: 'system',
          symbol: 'fragments.extraGuidance',
          metadata: expect.objectContaining({ injected: true, fragment: true }),
        }),
      ]),
    )
    expect(safe?.sourceRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'policy', property: 'check', symbol: 'policyCheck' })]),
    )
    expect(judge?.sourceRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'validator', property: 'score', symbol: 'judgeScore' })]),
    )
    expect(writerTool?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'execute', property: 'execute', symbol: 'runWriter' }),
        expect.objectContaining({ role: 'helper', property: 'writePlan', symbol: 'writePlan' }),
      ]),
    )
    expect(draftStep?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'handler', property: 'step', symbol: 'draftStep' }),
        expect.objectContaining({ role: 'helper', property: 'writePlan', symbol: 'writePlan' }),
      ]),
    )
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool.writes_blackboard', from: 'tool:writerTool', to: 'blackboard:notes' }),
        expect.objectContaining({
          type: 'flow.step.writes_blackboard',
          from: 'flow.step:writer-flow:draft',
          to: 'blackboard:notes',
        }),
        expect.objectContaining({
          type: 'prompt.reads_blackboard',
          from: 'prompt:writer-prompt',
          to: 'blackboard:notes',
        }),
        expect.objectContaining({
          type: 'context.reads_blackboard',
          from: 'context:active-context',
          to: 'blackboard:notes',
        }),
      ]),
    )
  })

  it('statically discovers rich Crux primitive definitions and relations', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/feature.ts'),
      `
        import { context, prompt } from '@crux/core'
        import { agent } from '@crux/core/agent'
        import { blackboard } from '@crux/core/agent/blackboard'
        import { flow } from '@crux/core/flow'
        import { fallback } from '@crux/core/routing'
        import { flow as cruxFlow } from '@crux/convex/server'
        import { Agent } from '@crux/convex/agent'
        import { memory, workingState } from '@crux/core/memory'
        import { retriever, retrievalPipeline } from '@crux/core/retrieval'
        import { constraint } from '@crux/core/safety/constraint'
        import { guardrail } from '@crux/core/safety/guardrail'
        import { llmJudge } from '@crux/core/scoring'
        import { evaluate } from '@crux/core/quality'
        import { createTool } from '@crux/core/tool'
        import type { FlowToolDef } from '@crux/core'
        import { z } from 'zod'

        export const brand = context({ id: 'brand', system: 'Brand voice' })
        const promptSafety = [safeTone]
        export const writerPrompt = prompt({ id: 'writer', use: [brand], constraints: promptSafety, prompt: 'Write' })
        export const searchDocs = createTool({
          name: 'searchDocs',
          description: 'Search docs',
          parameters: z.object({ query: z.string() }),
          execute: async () => {
            await sessionMemory.read('query')
            await notes.write('lastSearch', 'ok')
            return []
          },
        })
        export const calculatorSchema: FlowToolDef = {
          name: 'calculator',
          description: 'Calculate expressions',
          parameters: z.object({ expression: z.string() }),
        }
        export const writerAgent = agent({
          id: 'writer-agent',
          description: 'Writes drafts',
          prompt: writerPrompt,
          tools: [searchDocs],
          handoffs: ['reviewer-agent'],
          instructions: async () => {
            await sessionMemory.read('profile')
            await notes.write('activeAgent', 'writer')
            await scratch.readFile('/brand.md')
            return 'Write carefully'
          },
        })
        export const writerFlow = flow('writer-flow', async (flow) => {
          const draft = await flow.step('draft', async () => {
            await sessionMemory.read('draft')
            await notes.write('summary', 'done')
            await scratch.writeFile('/draft.md', 'done')
            return 'done'
          })
          await flow.waitFor('draft-approved')
          return draft
        })
        export const agentFlow = flow('agent-flow', async (flow) => flow.step('draft', writerAgent))
        export const convexWriterFlow = cruxFlow({
          name: 'convex-writer',
          args: { projectId: v.string(), query: v.string(), draftId: v.optional(v.id('drafts')) },
          handler: async (flow) => {
            const draft = await flow.step('draft', writerAgent)
            await flow.waitFor('plan-approval')
            return draft
          },
        })
        function createContextHandler(scope: string, mode: string) {
          return async () => ''
        }
        function createUsageHandler() {
          return async () => undefined
        }
        const baseTools = { searchDocs }
        const skillTools = { calculator: searchDocs }
        const tools = { ...baseTools, ...skillTools, searchDocs }
        const contextScope = 'thread'
        const mode = 'assist'
        const contextHandler = createContextHandler(contextScope, mode)
        const usageHandler = createUsageHandler()
        export async function createChatAgent() {
          const { model } = await resolve(writerPrompt, { model: languageModel })
          return new Agent(components.agent, {
            name: 'Karyla',
            languageModel: model,
            tools,
            contextHandler,
            usageHandler,
            maxSteps: 8,
          })
        }
        export const docsRetriever = retriever({ id: 'docs', namespace: 'kb', retrieve: async () => [] })
        export const docsRag = retrievalPipeline(docsRetriever, [{ name: 'rerank', scorer: factuality }])
        const sessionState = workingState({ id: 'state', schema: z.object({ user_name: z.string(), turn_count: z.number().optional() }) })
        const memoryStore = cruxConvexStore({ component: components.crux, ctx })
        const boardStore = cruxConvexStore({ component: components.crux, ctx })
        export const sessionMemory = memory({ id: 'session-memory', store: memoryStore, blocks: [sessionState] })
        export const notes = blackboard({ id: 'notes', store: boardStore, schema: z.object({ summary: z.string().optional() }) })
        export const scratch = workspace({
          id: 'scratch',
          namespace: 'thread:1',
          mounts: [{ path: '/workspace', access: 'readwrite', description: 'Working files' }],
          tools: { prefix: 'scratch', search: searchDocs },
        })
        export const safeTone = constraint({ name: 'safe-tone', severity: 'hard', appliesTo: [writerAgent], check: () => ({ ok: true }) })
        export const outputGuard = guardrail({ name: 'output-guard', phase: 'output', target: searchDocs, run: () => ({ ok: true }) })
        export const factuality = llmJudge({ id: 'factuality', criteria: 'Be factual', model: 'judge-model', threshold: 0.75, scale: { min: 0, max: 1 } })
        export const writerEval = evaluate('writer-eval', { task: writerPrompt, data: [] })
        export const writerFlowEval = evaluate('writer-flow-eval', { task: writerFlow, data: [] })
        export const docsRagEval = evaluate('docs-rag-eval', { task: docsRag, data: [] })
        export const writerParallel = parallel({ context: {}, agents: { writer: writerAgent } })
        export const writerPipeline = pipeline({
          context: {},
          steps: [
            { name: 'write', agent: writerAgent },
            { name: 'outline', prompt: writerPrompt },
            { name: 'search', tool: searchDocs },
          ],
        })
        export const flowPipeline = pipeline({ context: {}, steps: [{ name: 'run-flow', agent: agentFlow }] })
        export const writerConsensus = consensus({ input: {}, agents: [writerAgent], scorer: factuality, extract: () => 'ok' })
        export const writerSwarm = swarm({
          input: {},
          startAgent: 'writer-agent',
          agents: { 'writer-agent': writerAgent },
          blackboard: notes,
          memory: [sessionMemory],
        })
        export const badFallback = fallback('primary', 'backup')
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('agent:writer-agent')).toMatchObject({ kind: 'agent', name: 'writer-agent' })
    expect(byId.get('agent:writer-agent')?.metadata).toEqual(
      expect.objectContaining({
        runtimeJoin: expect.objectContaining({
          definitionId: 'agent:writer-agent',
          kind: 'agent',
          agentId: 'writer-agent',
          spanAttributes: expect.objectContaining({ agentId: 'writer-agent' }),
        }),
        facts: expect.objectContaining({
          kind: 'agent',
          promptId: 'writerPrompt',
          toolNames: ['searchDocs'],
          handoffs: ['reviewer-agent'],
        }),
        intelligence: expect.objectContaining({
          confidence: 'static',
          dependencies: expect.objectContaining({
            prompt: 'writerPrompt',
            prompts: expect.arrayContaining(['writerPrompt']),
            tools: expect.arrayContaining(['searchDocs']),
            handoffs: ['reviewer-agent'],
            agents: ['reviewer-agent'],
          }),
          data: expect.objectContaining({
            reads: expect.arrayContaining([
              expect.objectContaining({
                targetVariable: 'sessionMemory',
                targetKind: 'memory',
                operation: 'read',
                key: 'profile',
              }),
              expect.objectContaining({ targetVariable: 'scratch', operation: 'read', key: '/brand.md' }),
            ]),
            writes: [expect.objectContaining({ targetVariable: 'notes', operation: 'write', key: 'activeAgent' })],
          }),
        }),
      }),
    )
    expect(byId.get('tool:calculator')).toMatchObject({ kind: 'tool', name: 'calculator' })
    expect(byId.get('tool:searchDocs')?.metadata).toEqual(
      expect.objectContaining({
        facts: expect.objectContaining({
          kind: 'tool',
          toolName: 'searchDocs',
          hasExecute: true,
        }),
        intelligence: expect.objectContaining({
          confidence: 'static',
          contract: expect.objectContaining({
            inputSchema: expect.objectContaining({ type: 'object' }),
          }),
          data: expect.objectContaining({
            reads: [
              expect.objectContaining({
                targetVariable: 'sessionMemory',
                targetKind: 'memory',
                operation: 'read',
                key: 'query',
              }),
            ],
            writes: [expect.objectContaining({ targetVariable: 'notes', operation: 'write', key: 'lastSearch' })],
          }),
        }),
      }),
    )
    expect(byId.get('flow:writer-flow')).toMatchObject({ kind: 'flow', name: 'writer-flow' })
    expect(byId.get('flow:writer-flow')?.metadata).toEqual(
      expect.objectContaining({
        intelligence: expect.objectContaining({
          confidence: 'static',
          control: expect.objectContaining({
            mode: 'immediate',
            ordering: 'ordered',
            children: expect.arrayContaining(['flow.step:writer-flow:draft']),
            suspensionPoints: [
              expect.objectContaining({
                id: 'draft-approved',
                label: 'draft-approved',
                signal: 'draft-approved',
              }),
            ],
          }),
        }),
      }),
    )
    expect(byId.get('flow.step:writer-flow:draft')).toMatchObject({ kind: 'flow.step', name: 'draft' })
    expect(byId.get('flow.step:writer-flow:draft')?.metadata).toEqual(
      expect.objectContaining({
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'flow:writer-flow',
          parentRelationType: 'flow.includes_step',
          role: 'step',
          order: 0,
        }),
        facts: expect.objectContaining({
          kind: 'flow.step',
          flowId: 'flow:writer-flow',
          stepLabel: 'draft',
        }),
      }),
    )
    const writerFlow = byId.get('flow:writer-flow')
    expect(writerFlow).toBeDefined()
    const writerFlowJoin = (writerFlow!.metadata as Record<string, unknown>).runtimeJoin as Record<string, unknown>
    expect(writerFlowJoin).toEqual(
      expect.objectContaining({
        definitionId: 'flow:writer-flow',
        kind: 'flow',
        primitive: 'flow.run',
        spanName: 'writer-flow',
      }),
    )
    expect(writerFlowJoin.spanAttributes as Record<string, unknown>).not.toHaveProperty('flowId')
    const writerDraftStep = byId.get('flow.step:writer-flow:draft')
    expect(writerDraftStep).toBeDefined()
    const writerDraftJoin = (writerDraftStep!.metadata as Record<string, unknown>).runtimeJoin as Record<
      string,
      unknown
    >
    expect(writerDraftJoin).toEqual(
      expect.objectContaining({
        definitionId: 'flow.step:writer-flow:draft',
        kind: 'flow.step',
        primitive: 'flow.step',
        spanName: 'draft',
        parentDefinitionId: 'flow:writer-flow',
      }),
    )
    const writerDraftJoinAttributes = writerDraftJoin.spanAttributes as Record<string, unknown>
    expect(writerDraftJoinAttributes).toEqual(expect.objectContaining({ stepLabel: 'draft' }))
    expect(writerDraftJoinAttributes).not.toHaveProperty('flowId')
    expect(writerDraftJoinAttributes).not.toHaveProperty('stepId')
    expect(byId.get('flow.step:writer-flow:draft')?.metadata).toEqual(
      expect.objectContaining({
        intelligence: expect.objectContaining({
          confidence: 'static',
          data: expect.objectContaining({
            reads: [expect.objectContaining({ targetVariable: 'sessionMemory', key: 'draft' })],
            writes: expect.arrayContaining([
              expect.objectContaining({ targetVariable: 'notes', operation: 'write', key: 'summary' }),
              expect.objectContaining({ targetVariable: 'scratch', operation: 'write', key: '/draft.md' }),
            ]),
          }),
        }),
      }),
    )
    expect(byId.get('flow:agent-flow')).toMatchObject({ kind: 'flow', name: 'agent-flow' })
    expect(byId.get('flow.step:agent-flow:draft')).toMatchObject({ kind: 'flow.step', name: 'draft' })
    expect(byId.get('flow:convex-writer')).toMatchObject({
      kind: 'flow',
      name: 'convex-writer',
      metadata: expect.objectContaining({
        runtime: 'convex',
        args: ['projectId', 'query', 'draftId'],
        stepNames: ['draft'],
        argsSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            projectId: expect.objectContaining({ type: 'string' }),
            query: expect.objectContaining({ type: 'string' }),
            draftId: expect.objectContaining({ type: 'string', format: 'convex-id', table: 'drafts' }),
          }),
          required: ['projectId', 'query'],
        }),
        intelligence: expect.objectContaining({
          confidence: 'static',
          contract: expect.objectContaining({
            argsSchema: expect.objectContaining({
              properties: expect.objectContaining({
                projectId: expect.objectContaining({ type: 'string' }),
              }),
            }),
          }),
          control: expect.objectContaining({
            mode: 'durable',
            ordering: 'ordered',
            suspensionPoints: [
              expect.objectContaining({
                id: 'plan-approval',
                label: 'plan-approval',
                signal: 'plan-approval',
              }),
            ],
          }),
        }),
      }),
    })
    expect(byId.get('agent:Karyla')).toMatchObject({
      kind: 'agent',
      name: 'Karyla',
      metadata: expect.objectContaining({
        runtime: 'convex-agent',
        hasTools: true,
        hasContextHandler: true,
        hasUsageHandler: true,
        maxSteps: 'configured',
      }),
    })
    expect(byId.get('agent:Karyla')?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'config', property: 'tools', symbol: 'tools' }),
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'baseTools',
          metadata: expect.objectContaining({ toolMapContributor: 'spread' }),
        }),
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'skillTools',
          metadata: expect.objectContaining({ toolMapContributor: 'spread' }),
        }),
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'searchDocs',
          metadata: expect.objectContaining({ toolMapContributor: 'property' }),
        }),
        expect.objectContaining({ role: 'callback', property: 'contextHandler', symbol: 'contextHandler' }),
        expect.objectContaining({ role: 'callback', property: 'usageHandler', symbol: 'usageHandler' }),
        expect.objectContaining({ role: 'helper', property: 'createContextHandler', symbol: 'createContextHandler' }),
        expect.objectContaining({ role: 'helper', property: 'createUsageHandler', symbol: 'createUsageHandler' }),
        expect.objectContaining({
          role: 'config',
          property: 'contextHandler',
          symbol: 'contextScope',
          metadata: expect.objectContaining({ factoryArg: true, argumentIndex: 0, argumentName: 'contextScope' }),
        }),
        expect.objectContaining({
          role: 'config',
          property: 'contextHandler',
          symbol: 'mode',
          metadata: expect.objectContaining({ factoryArg: true, argumentIndex: 1, argumentName: 'mode' }),
        }),
      ]),
    )
    expect(byId.get('flow.step:agent-flow:draft')?.metadata).toEqual(
      expect.objectContaining({
        runtimeJoin: expect.objectContaining({
          definitionId: 'flow.step:agent-flow:draft',
          kind: 'flow.step',
          stepLabel: 'draft',
          spanName: 'draft',
          parentDefinitionId: 'flow:agent-flow',
          spanAttributes: expect.objectContaining({ stepLabel: 'draft' }),
        }),
      }),
    )
    expect(byId.get('rag.retriever:docs')).toMatchObject({ kind: 'rag.retriever', name: 'docs' })
    expect(byId.get('rag.pipeline:docsRag')).toMatchObject({ kind: 'rag.pipeline', name: 'docsRag' })
    expect(byId.get('rag.pipeline:docsRag:stage:rerank')).toMatchObject({
      kind: 'rag.pipeline.stage',
      name: 'rerank',
      metadata: expect.objectContaining({
        pipelineId: 'rag.pipeline:docsRag',
        stageId: 'rerank',
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'rag.pipeline:docsRag',
          parentRelationType: 'rag.pipeline.includes_stage',
          role: 'stage',
          order: 0,
        }),
        scorerVariable: 'factuality',
      }),
    })
    expect(byId.get('memory:session-memory')).toMatchObject({ kind: 'memory', name: 'session-memory' })
    expect(byId.get('memory.store:session-memory:memoryStore')).toMatchObject({
      kind: 'memory.store',
      name: 'memoryStore',
      metadata: expect.objectContaining({
        backend: 'cruxConvexStore',
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'memory:session-memory',
          parentRelationType: 'memory.uses_store',
          role: 'store',
        }),
        component: 'crux',
      }),
    })
    expect(byId.get('memory.block:session-memory:state')).toMatchObject({
      kind: 'memory.block',
      name: 'state',
      metadata: expect.objectContaining({
        memoryId: 'memory:session-memory',
        blockId: 'state',
        blockKind: 'working',
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'memory:session-memory',
          parentRelationType: 'memory.includes_block',
          role: 'block',
          order: 0,
        }),
        runtimeJoin: expect.objectContaining({
          definitionId: 'memory.block:session-memory:state',
          blockId: 'state',
          memoryId: 'session-memory',
          sourceDefinitionId: 'memory:session-memory',
          blockDefinitionId: 'memory.block:session-memory:state',
          spanAttributes: expect.objectContaining({
            memoryId: 'session-memory',
            blockId: 'state',
            sourceDefinitionId: 'memory:session-memory',
            blockDefinitionId: 'memory.block:session-memory:state',
          }),
        }),
        schema: expect.objectContaining({ type: 'object' }),
      }),
    })
    expect(byId.get('blackboard:notes')).toMatchObject({ kind: 'blackboard', name: 'notes' })
    const notesBlackboard = byId.get('blackboard:notes')
    expect(notesBlackboard).toBeDefined()
    expect((notesBlackboard!.metadata as Record<string, unknown>).runtimeJoin).toEqual(
      expect.objectContaining({
        definitionId: 'blackboard:notes',
        kind: 'blackboard',
        memoryId: 'notes',
        blockId: 'notes',
        sourceDefinitionId: 'blackboard:notes',
        spanAttributes: expect.objectContaining({
          memoryId: 'notes',
          blockId: 'notes',
          memoryType: 'blackboard',
          sourceDefinitionId: 'blackboard:notes',
        }),
      }),
    )
    expect(byId.get('workspace:scratch')).toMatchObject({ kind: 'workspace', name: 'scratch' })
    expect(byId.get('workspace:scratch')?.metadata).toEqual(
      expect.objectContaining({
        namespace: 'thread:1',
        hasTools: true,
        toolRefs: ['searchDocs'],
        mounts: [expect.objectContaining({ path: '/workspace', access: 'readwrite', description: 'Working files' })],
        intelligence: expect.objectContaining({
          confidence: 'static',
          tools: ['searchDocs'],
        }),
      }),
    )
    expect(byId.get('memory:session-memory')?.metadata).toEqual(
      expect.objectContaining({
        backend: 'cruxConvexStore',
        blockCount: 1,
        schema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            user_name: expect.objectContaining({ type: 'string' }),
            turn_count: expect.objectContaining({ type: 'number' }),
          }),
        }),
        blocks: [
          expect.objectContaining({
            id: 'state',
            kind: 'working',
            schema: expect.objectContaining({ type: 'object' }),
          }),
        ],
      }),
    )
    expect(byId.get('blackboard:notes')?.metadata).toEqual(
      expect.objectContaining({
        backend: 'cruxConvexStore',
        schema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({ summary: expect.objectContaining({ type: 'string' }) }),
        }),
      }),
    )
    expect(byId.get('constraint:safe-tone')).toMatchObject({
      kind: 'constraint',
      name: 'safe-tone',
      metadata: expect.objectContaining({ appliesTo: ['writerAgent'] }),
    })
    expect(byId.get('guardrail:output-guard')).toMatchObject({
      kind: 'guardrail',
      name: 'output-guard',
      metadata: expect.objectContaining({ appliesTo: ['searchDocs'] }),
    })
    expect(byId.get('scorer:factuality')).toMatchObject({ kind: 'scorer', name: 'factuality' })
    expect(byId.get('evaluation:writer-eval')).toMatchObject({
      kind: 'evaluation',
      metadata: expect.objectContaining({ covers: ['writerPrompt'] }),
    })
    expect(byId.get('evaluation:writer-flow-eval')).toMatchObject({
      kind: 'evaluation',
      metadata: expect.objectContaining({ covers: ['writerFlow'] }),
    })
    expect(byId.get('evaluation:docs-rag-eval')).toMatchObject({
      kind: 'evaluation',
      metadata: expect.objectContaining({ covers: ['docsRag'] }),
    })
    expect(byId.get('composition.parallel:writerParallel')).toMatchObject({ kind: 'composition.parallel' })
    expect(byId.get('composition.parallel:writerParallel:branch:writer')).toMatchObject({
      kind: 'composition.parallel.branch',
      name: 'writer',
      metadata: expect.objectContaining({
        compositionId: 'composition.parallel:writerParallel',
        branchId: 'writer',
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'composition.parallel:writerParallel',
          parentRelationType: 'parallel.includes_branch',
          role: 'branch',
          order: 0,
        }),
        targetVariable: 'writerAgent',
      }),
    })
    expect(byId.get('composition.pipeline:writerPipeline')).toMatchObject({ kind: 'composition.pipeline' })
    expect(byId.get('composition.pipeline:writerPipeline:stage:write')).toMatchObject({
      kind: 'composition.pipeline.stage',
      name: 'write',
      metadata: expect.objectContaining({
        compositionId: 'composition.pipeline:writerPipeline',
        stageId: 'write',
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'composition.pipeline:writerPipeline',
          parentRelationType: 'pipeline.includes_stage',
          role: 'stage',
          order: 0,
        }),
        targetVariable: 'writerAgent',
        targetProperty: 'agent',
      }),
    })
    expect(byId.get('composition.pipeline:writerPipeline:stage:outline')).toMatchObject({
      kind: 'composition.pipeline.stage',
      name: 'outline',
      metadata: expect.objectContaining({
        targetVariable: 'writerPrompt',
        targetProperty: 'prompt',
      }),
    })
    expect(byId.get('composition.pipeline:writerPipeline:stage:search')).toMatchObject({
      kind: 'composition.pipeline.stage',
      name: 'search',
      metadata: expect.objectContaining({
        targetVariable: 'searchDocs',
        targetProperty: 'tool',
      }),
    })
    expect(byId.get('composition.pipeline:flowPipeline')).toMatchObject({ kind: 'composition.pipeline' })
    expect(byId.get('composition.consensus:writerConsensus')).toMatchObject({ kind: 'composition.consensus' })
    expect(byId.get('composition.consensus:writerConsensus')?.metadata).toEqual(
      expect.objectContaining({
        participants: ['writerAgent'],
        scorer: 'factuality',
        intelligence: expect.objectContaining({
          confidence: 'static',
          control: expect.objectContaining({ mode: 'consensus', ordering: 'concurrent' }),
        }),
      }),
    )
    expect(byId.get('composition.swarm:writerSwarm')).toMatchObject({ kind: 'composition.swarm' })
    expect(byId.get('composition.swarm:writerSwarm')?.metadata).toEqual(
      expect.objectContaining({
        coordinator: 'writer-agent',
        participants: ['writerAgent'],
        sharedBlackboard: 'notes',
        sharedMemory: ['sessionMemory'],
        intelligence: expect.objectContaining({
          confidence: 'static',
          control: expect.objectContaining({ mode: 'swarm', ordering: 'event-driven' }),
        }),
      }),
    )

    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:writer-agent', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:writer-agent', to: 'tool:searchDocs' }),
        expect.objectContaining({
          type: 'agent.reads_memory',
          from: 'agent:writer-agent',
          to: 'memory:session-memory',
        }),
        expect.objectContaining({
          type: 'agent.writes_blackboard',
          from: 'agent:writer-agent',
          to: 'blackboard:notes',
        }),
        expect.objectContaining({ type: 'agent.reads_workspace', from: 'agent:writer-agent', to: 'workspace:scratch' }),
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:Karyla', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:Karyla', to: 'tool:searchDocs' }),
        expect.objectContaining({
          type: 'agent.can_handoff_to',
          from: 'agent:writer-agent',
          to: 'agent:reviewer-agent',
        }),
        expect.objectContaining({ type: 'tool.reads_memory', from: 'tool:searchDocs', to: 'memory:session-memory' }),
        expect.objectContaining({ type: 'tool.writes_blackboard', from: 'tool:searchDocs', to: 'blackboard:notes' }),
        expect.objectContaining({
          type: 'flow.includes_step',
          from: 'flow:writer-flow',
          to: 'flow.step:writer-flow:draft',
        }),
        expect.objectContaining({
          type: 'flow.step.waits_for_signal',
          from: 'flow.step:writer-flow:draft',
          to: 'signal:draft-approved',
        }),
        expect.objectContaining({
          type: 'flow.step.reads_memory',
          from: 'flow.step:writer-flow:draft',
          to: 'memory:session-memory',
        }),
        expect.objectContaining({
          type: 'flow.step.writes_blackboard',
          from: 'flow.step:writer-flow:draft',
          to: 'blackboard:notes',
        }),
        expect.objectContaining({
          type: 'flow.step.writes_workspace',
          from: 'flow.step:writer-flow:draft',
          to: 'workspace:scratch',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_agent',
          from: 'flow.step:agent-flow:draft',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_agent',
          from: 'flow.step:convex-writer:draft',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'flow.step.waits_for_signal',
          from: 'flow.step:convex-writer:draft',
          to: 'signal:plan-approval',
        }),
        expect.objectContaining({
          type: 'rag.pipeline.uses_retriever',
          from: 'rag.pipeline:docsRag',
          to: 'rag.retriever:docs',
        }),
        expect.objectContaining({
          type: 'rag.pipeline.includes_stage',
          from: 'rag.pipeline:docsRag',
          to: 'rag.pipeline:docsRag:stage:rerank',
        }),
        expect.objectContaining({
          type: 'rag.pipeline.stage.uses_scorer',
          from: 'rag.pipeline:docsRag:stage:rerank',
          to: 'scorer:factuality',
        }),
        expect.objectContaining({
          type: 'memory.includes_block',
          from: 'memory:session-memory',
          to: 'memory.block:session-memory:state',
        }),
        expect.objectContaining({
          type: 'memory.uses_store',
          from: 'memory:session-memory',
          to: 'memory.store:session-memory:memoryStore',
        }),
        expect.objectContaining({
          type: 'blackboard.uses_store',
          from: 'blackboard:notes',
          to: 'memory.store:notes:boardStore',
        }),
        expect.objectContaining({ type: 'workspace.exposes_tool', from: 'workspace:scratch', to: 'tool:searchDocs' }),
        expect.objectContaining({
          type: 'workspace.mounts_path',
          from: 'workspace:scratch',
          to: 'workspace.path:scratch:workspace',
        }),
        expect.objectContaining({
          type: 'constraint.applies_to',
          from: 'constraint:safe-tone',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'guardrail.applies_to',
          from: 'guardrail:output-guard',
          to: 'tool:searchDocs',
        }),
        expect.objectContaining({
          type: 'eval.covers_definition',
          from: 'evaluation:writer-eval',
          to: 'prompt:writer',
        }),
        expect.objectContaining({
          type: 'eval.covers_definition',
          from: 'evaluation:writer-flow-eval',
          to: 'flow:writer-flow',
        }),
        expect.objectContaining({
          type: 'eval.covers_definition',
          from: 'evaluation:docs-rag-eval',
          to: 'rag.pipeline:docsRag',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.parallel:writerParallel',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'parallel.includes_branch',
          from: 'composition.parallel:writerParallel',
          to: 'composition.parallel:writerParallel:branch:writer',
        }),
        expect.objectContaining({
          type: 'parallel.branch.uses_agent',
          from: 'composition.parallel:writerParallel:branch:writer',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.pipeline:writerPipeline',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'pipeline.includes_stage',
          from: 'composition.pipeline:writerPipeline',
          to: 'composition.pipeline:writerPipeline:stage:write',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_agent',
          from: 'composition.pipeline:writerPipeline:stage:write',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'pipeline.includes_stage',
          from: 'composition.pipeline:writerPipeline',
          to: 'composition.pipeline:writerPipeline:stage:outline',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_prompt',
          from: 'composition.pipeline:writerPipeline:stage:outline',
          to: 'prompt:writer',
        }),
        expect.objectContaining({
          type: 'pipeline.includes_stage',
          from: 'composition.pipeline:writerPipeline',
          to: 'composition.pipeline:writerPipeline:stage:search',
        }),
        expect.objectContaining({
          type: 'pipeline.stage.uses_tool',
          from: 'composition.pipeline:writerPipeline:stage:search',
          to: 'tool:searchDocs',
        }),
        expect.objectContaining({
          type: 'composition.uses_flow',
          from: 'composition.pipeline:flowPipeline',
          to: 'flow:agent-flow',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.consensus:writerConsensus',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'consensus.includes_agent',
          from: 'composition.consensus:writerConsensus',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'consensus.uses_scorer',
          from: 'composition.consensus:writerConsensus',
          to: 'scorer:factuality',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.swarm:writerSwarm',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'swarm.includes_agent',
          from: 'composition.swarm:writerSwarm',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'swarm.coordinated_by',
          from: 'composition.swarm:writerSwarm',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'swarm.uses_blackboard',
          from: 'composition.swarm:writerSwarm',
          to: 'blackboard:notes',
        }),
        expect.objectContaining({
          type: 'swarm.uses_memory',
          from: 'composition.swarm:writerSwarm',
          to: 'memory:session-memory',
        }),
      ]),
    )
    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'definition.missing_eval_coverage',
          relatedDefinitionIds: ['agent:writer-agent'],
          maturity: 'preview',
          severity: 'info',
        }),
        expect.objectContaining({
          ruleId: 'flow.suspension_without_coverage',
          relatedDefinitionIds: ['flow:convex-writer'],
          maturity: 'preview',
          severity: 'warning',
        }),
        expect.objectContaining({
          ruleId: 'workspace.write_without_guardrail',
          relatedDefinitionIds: ['workspace:scratch'],
          maturity: 'preview',
          severity: 'warning',
        }),
        expect.objectContaining({
          ruleId: 'shared_blackboard_without_policy',
          relatedDefinitionIds: ['composition.swarm:writerSwarm', 'blackboard:notes'],
          maturity: 'preview',
          severity: 'warning',
        }),
      ]),
    )
    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ maturity: 'advisory' })]),
    )
    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'flow.suspension_without_coverage',
          relatedDefinitionIds: ['flow:writer-flow'],
        }),
      ]),
    )
    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'memory.long_lived_without_retention',
          relatedDefinitionIds: ['memory:session'],
        }),
      ]),
    )
  })

  it('statically discovers Crux Convex profile agents', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/convex-agent.ts'),
      `
        import { convexAgent, createCruxConvex, prompt } from '@crux/convex'
        import { tool } from '@crux/convex/tools'
        import { z } from 'zod'
        import { components } from './_generated/api'

        const model = {} as never
        export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })
        export const searchDocs = tool({
          name: 'searchDocs',
          description: 'Search docs',
          parameters: z.object({ query: z.string() }),
          execute: async () => [],
        })
        export const crux = createCruxConvex({
          components: {
            crux: components.crux,
            agent: components.agent,
          },
        })

        const extraTools = { searchDocs }
        const mode = 'assist'
        function createUsageHandler(projectId: string) {
          return async () => projectId
        }
        function createPrepare(activeMode: string) {
          return async () => ({ input: { mode: activeMode } })
        }
        const usageHandler = createUsageHandler('project')
        const prepare = createPrepare(mode)

        export const profileAgent = crux.convexAgent({
          name: 'Profile Writer',
          prompt: writerPrompt,
          model,
          tools: extraTools,
          usageHandler,
          prepare,
          tokenBudget: 1000,
        })

        export const directAgent = convexAgent({
          components: {
            crux: components.crux,
            agent: components.agent,
          },
          name: 'Direct Writer',
          prompt: writerPrompt,
          model,
          tools: { searchDocs },
          prepare: async () => ({ tools: { searchDocs } }),
        })

        export function makeAgent() {
          return crux.convexAgent({
            name: 'Factory Writer',
            prompt: writerPrompt,
            model,
            usageHandler: createUsageHandler('factory'),
            prepare: createPrepare(mode),
          })
        }
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('agent:Profile-Writer')).toMatchObject({
      kind: 'agent',
      name: 'Profile Writer',
      metadata: expect.objectContaining({
        runtime: 'convex-agent',
        hasTools: true,
        hasUsageHandler: true,
        hasPrepare: true,
      }),
    })
    expect(byId.get('agent:Direct-Writer')).toMatchObject({
      kind: 'agent',
      name: 'Direct Writer',
      metadata: expect.objectContaining({
        runtime: 'convex-agent',
        hasTools: true,
        hasPrepare: true,
      }),
    })
    expect(byId.get('agent:Factory-Writer')).toMatchObject({
      kind: 'agent',
      name: 'Factory Writer',
      metadata: expect.objectContaining({
        runtime: 'convex-agent',
        hasUsageHandler: true,
        hasPrepare: true,
      }),
    })
    expect(byId.get('agent:Profile-Writer')?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'config', property: 'prompt', symbol: 'writerPrompt' }),
        expect.objectContaining({ role: 'config', property: 'tools', symbol: 'extraTools' }),
        expect.objectContaining({
          role: 'config',
          property: 'tools',
          symbol: 'searchDocs',
          metadata: expect.objectContaining({ toolMapContributor: 'property' }),
        }),
        expect.objectContaining({ role: 'callback', property: 'usageHandler', symbol: 'usageHandler' }),
        expect.objectContaining({ role: 'callback', property: 'prepare', symbol: 'prepare' }),
        expect.objectContaining({ role: 'helper', property: 'createUsageHandler', symbol: 'createUsageHandler' }),
        expect.objectContaining({ role: 'helper', property: 'createPrepare', symbol: 'createPrepare' }),
        expect.objectContaining({
          role: 'config',
          property: 'prepare',
          symbol: 'mode',
          metadata: expect.objectContaining({ factoryArg: true, argumentIndex: 0, argumentName: 'mode' }),
        }),
      ]),
    )
    expect(byId.get('agent:Factory-Writer')?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'helper', property: 'createUsageHandler', symbol: 'createUsageHandler' }),
        expect.objectContaining({ role: 'helper', property: 'createPrepare', symbol: 'createPrepare' }),
        expect.objectContaining({
          role: 'config',
          property: 'prepare',
          symbol: 'mode',
          metadata: expect.objectContaining({ factoryArg: true, argumentIndex: 0, argumentName: 'mode' }),
        }),
      ]),
    )
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:Profile-Writer', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:Profile-Writer', to: 'tool:searchDocs' }),
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:Direct-Writer', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:Direct-Writer', to: 'tool:searchDocs' }),
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:Factory-Writer', to: 'prompt:writer' }),
      ]),
    )
  })

  it('surfaces tools from runtime-injected tool context factories', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/runtime-tools.ts'),
      `
        import { context, prompt } from '@crux/convex'
        import type { ConvexAgentPrepareArgs, ConvexAgentPrepareResult } from '@crux/convex/agent'
        import { memory } from '@crux/convex/memory'
        import { tool } from '@crux/convex/tools'
        import { blackboard, retriever } from '@crux/core'
        import { z } from 'zod'

        export const karylaAgent = prompt({ id: 'karyla-agent', prompt: 'Help.' })
        export const sessionMemory = memory({ id: 'session' })
        export const userEpisodes = memory({ id: 'user-episodes' })
        export const threadBlackboard = blackboard({ id: 'thread' })
        export const projectKnowledgeRetriever = retriever({
          id: 'project-knowledge',
          retrieve: async () => [],
        })
        export const searchDocs = tool({
          name: 'searchDocs',
          description: 'Search docs',
          input: z.object({ query: z.string() }),
          execute: async () => [],
        })
        export const planTool = tool({
          name: 'planTool',
          description: 'Plan',
          input: z.object({}),
          execute: async () => [],
        })

        function createKarylaTools(mode?: string, planId?: string) {
          const allTools = {
            searchDocs,
            ...(planId ? { planTool } : {}),
          }
          if (mode) {
            const filteredTools: Record<string, unknown> = {}
            return filteredTools
          }
          return allTools
        }

        function createKarylaToolContext(mode?: string, planId?: string) {
          return context({
            id: 'karyla-tools',
            system: '',
            tools: createKarylaTools(mode, planId),
          })
        }

        async function createKarylaRuntimeUse(mode?: string) {
          const session = { memory: sessionMemory }
          const episodic = { memory: userEpisodes }
          const projectKnowledge = { retriever: projectKnowledgeRetriever }
          const blackboard = threadBlackboard
          const tools = createKarylaToolContext(mode)
          return [session.memory, projectKnowledge.retriever, tools, episodic.memory, blackboard]
        }

        export function createKarylaPrepare() {
          return async ({
            input,
          }: ConvexAgentPrepareArgs<typeof karylaAgent>): Promise<ConvexAgentPrepareResult<typeof karylaAgent>> => {
            return {
              input,
              use: await createKarylaRuntimeUse('chat'),
            }
          }
        }
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))
    const promptFacts = byId.get('prompt:karyla-agent')?.metadata?.facts
    const contextFacts = byId.get('context:karyla-tools')?.metadata?.facts

    expect(promptFacts?.kind).toBe('prompt')
    expect(promptFacts?.kind === 'prompt' ? promptFacts.useEntries : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: 'session.memory',
          via: 'runtime',
          targetDefinitionId: 'memory:session',
          targetKind: 'memory',
          relationHint: 'memory',
        }),
        expect.objectContaining({
          variable: 'projectKnowledge.retriever',
          via: 'runtime',
          targetDefinitionId: 'rag.retriever:project-knowledge',
          targetKind: 'rag.retriever',
        }),
        expect.objectContaining({
          variable: 'tools',
          via: 'runtime',
          targetDefinitionId: 'context:karyla-tools',
          targetKind: 'context',
          relationHint: 'context',
        }),
        expect.objectContaining({
          variable: 'episodic.memory',
          via: 'runtime',
          targetDefinitionId: 'memory:user-episodes',
          targetKind: 'memory',
          relationHint: 'memory',
        }),
        expect.objectContaining({
          variable: 'blackboard',
          via: 'runtime',
          targetDefinitionId: 'blackboard:thread',
          targetKind: 'blackboard',
          relationHint: 'blackboard',
        }),
      ]),
    )
    expect(contextFacts?.kind).toBe('context')
    expect(contextFacts?.kind === 'context' ? contextFacts.tools : undefined).toEqual(
      expect.objectContaining({
        hasTools: true,
        dynamic: true,
        names: expect.arrayContaining(['searchDocs']),
        variables: expect.arrayContaining(['searchDocs']),
      }),
    )
    expect(byId.get('context:karyla-tools')?.metadata?.intelligence?.dependencies?.tools).toEqual(
      expect.arrayContaining(['tool:searchDocs']),
    )
  })

  it('applies lint profile and rule overrides from crux config', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        export default config({
          prompts: [],
          tools: [{ name: 'searchDocs', description: 'Search docs' }],
          lint: {
            profile: 'recommended',
            rules: {
              'tool.missing_input_schema': { severity: 'warning' },
              'definition.missing_eval_coverage': { enabled: false },
              'missing.rule': { enabled: false },
            },
          },
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'lint-config' })

    expect(snapshot.lint).toEqual({
      profile: 'recommended',
      rules: {
        'tool.missing_input_schema': { severity: 'warning' },
        'definition.missing_eval_coverage': { enabled: false },
        'missing.rule': { enabled: false },
      },
    })
    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'tool.missing_input_schema',
          severity: 'warning',
          relatedDefinitionIds: ['tool:searchDocs'],
        }),
      ]),
    )
    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: 'definition.missing_eval_coverage' })]),
    )
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'index.lint_unknown_configured_rule',
          message: expect.stringContaining('missing.rule'),
        }),
      ]),
    )
  })

  it('emits high-trust contract lint findings from first-class definitions', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        export default config({
          prompts: [],
          contexts: [],
          tools: [],
          lint: { profile: 'strict' },
        })
      `,
    )
    await writeFile(
      join(root, 'static-contracts.ts'),
      `
        import { context, createTool, flow, prompt } from '@crux/core'
        import { z } from 'zod'

        function makeSchema() {
          return z.object({ topic: z.string() })
        }

        const RuntimeSchema = makeSchema()

        throw new Error('static-only fixture')

        export const dynamicPrompt = prompt({
          id: 'dynamic-prompt',
          prompt: ({ input }) => input.topic,
        })

        export const noOutputPrompt = prompt({
          id: 'no-output-prompt',
          input: z.object({ topic: z.string() }),
          prompt: ({ input }) => input.topic,
        })

        export const dynamicContext = context({
          id: 'dynamic-context',
          input: RuntimeSchema,
          system: ({ input }) => input.topic,
        })

        export const writeDraft = createTool({
          name: 'writeDraft',
          description: 'Write a draft',
          parameters: z.object({ topic: z.string() }),
          execute: async () => ({ ok: true }),
        })

        const draftStep = async () => 'done'

        export const writerFlow = flow({
          name: 'writer-flow',
          args: RuntimeSchema,
          handler: async (flow, args) => {
            return flow.step('draft', draftStep, args)
          },
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'contract-lints' })

    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'prompt.missing_input_schema',
          relatedDefinitionIds: ['prompt:dynamic-prompt'],
          category: 'contracts',
          maturity: 'stable',
          confidence: 'high',
        }),
        expect.objectContaining({
          ruleId: 'prompt.missing_output_schema',
          relatedDefinitionIds: ['prompt:no-output-prompt'],
          profiles: ['strict'],
        }),
        expect.objectContaining({
          ruleId: 'context.missing_input_schema',
          relatedDefinitionIds: ['context:dynamic-context'],
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'source',
              label: 'Unresolved input schema source',
            }),
          ]),
        }),
        expect.objectContaining({
          ruleId: 'flow.untyped_args',
          relatedDefinitionIds: ['flow:writer-flow'],
        }),
        expect.objectContaining({
          ruleId: 'tool.output_not_inspectable',
          relatedDefinitionIds: ['tool:writeDraft'],
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'definition',
              label: 'Executable tool has no model-output adapter',
            }),
          ]),
        }),
      ]),
    )
    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'prompt.missing_input_schema',
          relatedDefinitionIds: ['prompt:no-output-prompt'],
        }),
        expect.objectContaining({
          ruleId: 'context.missing_input_schema',
          relatedDefinitionIds: ['context:static-context'],
        }),
      ]),
    )
  })

  it('emits a handoff observability lint when an agent target is not index-visible', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'agents.ts'),
      `
        import { agent, prompt } from '@crux/core'

        export const triagePrompt = prompt({
          id: 'triage-prompt',
          prompt: 'Route the request.',
        })

        export const triage = agent({
          id: 'triage',
          prompt: triagePrompt,
          handoffs: ['billing'],
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'handoff-lints' })

    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'agent.unobservable_handoff',
          category: 'observability',
          maturity: 'preview',
          confidence: 'medium',
          primaryDefinitionId: 'agent:triage',
          relatedDefinitionIds: ['agent:triage', 'agent:billing'],
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'relation',
              label: 'Handoff target is not index-visible',
            }),
          ]),
        }),
      ]),
    )
  })

  it('emits composition lints for consensus definitions without visible judge or scorer', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { agent } from '@crux/core/agent'
        import { consensus } from '@crux/core/compositions'

        const writer = agent({ id: 'writer', instructions: 'Write.' })
        const reviewer = agent({ id: 'reviewer', instructions: 'Review.' })

        export const draftConsensus = consensus({
          input: {},
          agents: [writer, reviewer],
          extract: () => 'ok',
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'consensus-lints' })

    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'consensus.missing_judge',
          relatedDefinitionIds: ['composition.consensus:draftConsensus'],
          category: 'composition',
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'definition',
              label: 'Consensus has no visible judge or scorer',
            }),
          ]),
        }),
      ]),
    )
  })

  it('indexes authored routing routers with route children and classifier source refs', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'routing.ts'),
      `
        import { router } from '@crux/core/routing'

        const cheapModel = { modelId: 'cheap' }
        const preciseModel = { modelId: 'precise' }
        const defaultModel = { modelId: 'default' }

        function classifyQuality(input: Record<string, unknown>) {
          return input.kind === 'precise' ? 'precise' : 'cheap'
        }

        export const qualityRouter = router({
          id: 'quality-router',
          classify: classifyQuality,
          routes: {
            cheap: cheapModel,
            precise: preciseModel,
            default: defaultModel,
          },
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'routing-router', staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('routing.router:quality-router')).toMatchObject({
      kind: 'routing.router',
      name: 'quality-router',
      metadata: expect.objectContaining({
        routingId: 'quality-router',
        routeKeys: ['cheap', 'precise', 'default'],
        routeCount: 3,
        hasDefaultRoute: true,
        hasClassify: true,
        runtimeJoin: expect.objectContaining({
          primitive: 'routing.router',
          spanAttributes: expect.objectContaining({ routingId: 'quality-router' }),
        }),
        intelligence: expect.objectContaining({
          control: expect.objectContaining({ mode: 'routing', ordering: 'conditional' }),
        }),
      }),
    })
    expect(byId.get('routing.router:quality-router:route:cheap')).toMatchObject({
      kind: 'routing.router.route',
      name: 'cheap',
      metadata: expect.objectContaining({
        routerDefinitionId: 'routing.router:quality-router',
        routeKey: 'cheap',
        isDefault: false,
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'routing.router:quality-router',
          parentRelationType: 'router.includes_route',
          role: 'route',
          order: 0,
        }),
        targetVariable: 'cheapModel',
      }),
    })
    expect(byId.get('routing.router:quality-router:route:default')).toMatchObject({
      kind: 'routing.router.route',
      metadata: expect.objectContaining({ isDefault: true }),
    })
    expect(byId.get('routing.router:quality-router')?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'callback',
          property: 'classify',
        }),
      ]),
    )
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'router.includes_route',
          from: 'routing.router:quality-router',
          to: 'routing.router:quality-router:route:cheap',
        }),
        expect.objectContaining({
          type: 'router.includes_route',
          from: 'routing.router:quality-router',
          to: 'routing.router:quality-router:route:default',
        }),
      ]),
    )
  })

  it('indexes inline routing models without treating unrelated method calls as Crux routing', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'inline-routing.ts'),
      `
        import { cascade, router } from '@crux/core/routing'

        const fastModel = { modelId: 'fast' }
        const creativeModel = { modelId: 'creative' }

        function accepts(result: unknown) {
          return Boolean(result)
        }

        function generate(_prompt: unknown, options: { model: unknown }) {
          return options
        }

        export function edit() {
          return generate('draft-edit', {
            model: router({
              classify: (input) => String((input as { kind?: string }).kind ?? 'fast'),
              routes: {
                fast: fastModel,
                default: creativeModel,
              },
            }),
          })
        }

        export function plan() {
          return generate('research-planner', {
            model: cascade({
              tiers: [
                { model: fastModel, evaluate: accepts },
                { model: creativeModel },
              ],
              budget: { maxCost: 0.02 },
            }),
          })
        }

        const ai = { router(_options: unknown) { return null } }
        const props = { fallback(_error: unknown, _retry: unknown) { return null } }
        ai.router({ feature: 'not-crux-routing' })
        props.fallback(new Error('not crux'), () => null)
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'inline-routing', staticOnly: true })
    const routers = snapshot.definitions.filter((definition) => definition.kind === 'routing.router')
    const routes = snapshot.definitions.filter((definition) => definition.kind === 'routing.router.route')
    const cascades = snapshot.definitions.filter((definition) => definition.kind === 'routing.cascade')
    const tiers = snapshot.definitions.filter((definition) => definition.kind === 'routing.cascade.tier')
    const fallbacks = snapshot.definitions.filter((definition) => definition.kind === 'routing.fallback')

    expect(routers).toHaveLength(1)
    expect(routers[0]).toMatchObject({
      metadata: expect.objectContaining({
        hasStableId: false,
        routeKeys: ['fast', 'default'],
        routeCount: 2,
        hasDefaultRoute: true,
      }),
    })
    expect(routes.map((definition) => definition.name).sort()).toEqual(['default', 'fast'])
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            indexPresentation: expect.objectContaining({
              standalone: false,
              parentDefinitionId: routers[0]!.id,
              parentRelationType: 'router.includes_route',
              role: 'route',
            }),
          }),
        }),
      ]),
    )
    expect(cascades).toHaveLength(1)
    expect(cascades[0]).toMatchObject({
      metadata: expect.objectContaining({
        hasStableId: false,
        tierCount: 2,
        hasBudget: true,
      }),
    })
    expect(tiers).toHaveLength(2)
    expect(tiers[0]!.metadata).toEqual(
      expect.objectContaining({
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: cascades[0]!.id,
          parentRelationType: 'cascade.includes_tier',
          role: 'tier',
          order: 0,
        }),
      }),
    )
    expect(fallbacks).toHaveLength(0)
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'router.includes_route' }),
        expect.objectContaining({ type: 'cascade.includes_tier' }),
      ]),
    )
  })

  it('indexes authored routing cascades and fallback policies as ordered child graphs', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'routing.ts'),
      `
        import { cascade, fallback } from '@crux/core/routing'

        const cheapModel = { modelId: 'cheap' }
        const strongModel = { modelId: 'strong' }
        const backupModel = { modelId: 'backup' }

        function acceptsCheap(result: unknown) {
          return Boolean(result)
        }

        export const qualityFallback = fallback(strongModel, backupModel, {
          id: 'quality-fallback',
          timeoutMs: 5000,
        })

        export const qualityCascade = cascade({
          id: 'quality-cascade',
          budget: { maxCost: 0.05, maxLatencyMs: 5000 },
          tiers: [
            { model: cheapModel, evaluate: acceptsCheap, budget: 0.75, note: 'cheap pass' },
            { model: qualityFallback },
          ],
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'routing-cascade', staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('routing.cascade:quality-cascade')).toMatchObject({
      kind: 'routing.cascade',
      name: 'quality-cascade',
      metadata: expect.objectContaining({
        routingId: 'quality-cascade',
        tierCount: 2,
        hasBudget: true,
        budget: { maxCost: 0.05, maxLatencyMs: 5000 },
        runtimeJoin: expect.objectContaining({
          primitive: 'routing.cascade',
          spanAttributes: expect.objectContaining({ routingId: 'quality-cascade' }),
        }),
      }),
    })
    expect(byId.get('routing.cascade:quality-cascade:tier:1')).toMatchObject({
      kind: 'routing.cascade.tier',
      metadata: expect.objectContaining({
        cascadeDefinitionId: 'routing.cascade:quality-cascade',
        tierIndex: 0,
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'routing.cascade:quality-cascade',
          parentRelationType: 'cascade.includes_tier',
          role: 'tier',
          order: 0,
        }),
        targetVariable: 'cheapModel',
        budget: 0.75,
        note: 'cheap pass',
        hasEvaluate: true,
      }),
    })
    expect(byId.get('routing.cascade:quality-cascade:tier:1')?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'callback',
          property: 'evaluate',
        }),
      ]),
    )
    expect(byId.get('routing.fallback:quality-fallback')).toMatchObject({
      kind: 'routing.fallback',
      metadata: expect.objectContaining({
        routingId: 'quality-fallback',
        optionCount: 2,
        options: { id: 'quality-fallback', timeoutMs: 5000 },
        runtimeJoin: expect.objectContaining({
          primitive: 'fallback.attempt',
          spanAttributes: expect.objectContaining({ routingId: 'quality-fallback' }),
        }),
      }),
    })
    expect(byId.get('routing.fallback:quality-fallback:option:1')).toMatchObject({
      kind: 'routing.fallback.option',
      metadata: expect.objectContaining({
        indexPresentation: expect.objectContaining({
          standalone: false,
          parentDefinitionId: 'routing.fallback:quality-fallback',
          parentRelationType: 'fallback.includes_option',
          role: 'option',
          order: 0,
        }),
      }),
    })
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cascade.includes_tier',
          from: 'routing.cascade:quality-cascade',
          to: 'routing.cascade:quality-cascade:tier:1',
        }),
        expect.objectContaining({
          type: 'fallback.includes_option',
          from: 'routing.fallback:quality-fallback',
          to: 'routing.fallback:quality-fallback:option:1',
        }),
        expect.objectContaining({
          type: 'cascade.tier.uses_fallback',
          from: 'routing.cascade:quality-cascade:tier:2',
          to: 'routing.fallback:quality-fallback',
        }),
      ]),
    )
  })

  it('semantically resolves imported routing targets and higher-level routing usage', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'models.ts'),
      `
        import { agent, prompt } from '@crux/core'
        import { cascade, fallback, router } from '@crux/core/routing'

        export const writerPrompt = prompt({ id: 'writer-prompt', input: {}, prompt: () => 'write' })
        export const writerAgent = agent({ id: 'writer-agent', prompt: writerPrompt })

        function accepted(result: unknown) {
          return Boolean(result)
        }

        export const importedFallback = fallback(writerAgent, writerPrompt, {
          id: 'imported-fallback',
          timeoutMs: 2500,
        })

        export const importedCascade = cascade({
          id: 'imported-cascade',
          tiers: [
            { model: importedFallback, evaluate: accepted },
            { model: writerAgent },
          ],
        })

        function classifyRoute(input: { kind?: string }) {
          return input.kind === 'fallback' ? 'fallback' : 'cascade'
        }

        export const semanticRouter = router({
          id: 'semantic-router',
          classify: classifyRoute,
          routes: {
            cascade: importedCascade,
            fallback: importedFallback,
            default: writerAgent,
          },
        })
      `,
    )
    await writeFile(
      join(root, 'app.ts'),
      `
        import { agent, flow, parallel } from '@crux/core'
        import { semanticRouter } from './models'

        export const orchestrator = agent({
          id: 'orchestrator',
          languageModel: semanticRouter,
        })

        export const routedFlow = flow({
          name: 'routed-flow',
          handler: async (flow) => {
            return flow.step('route', semanticRouter)
          },
        })

        export const routedParallel = parallel({
          agents: {
            routed: semanticRouter,
          },
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'routing-semantic' })

    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'router.route.uses_cascade',
          from: 'routing.router:semantic-router:route:cascade',
          to: 'routing.cascade:imported-cascade',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'router.route.uses_fallback',
          from: 'routing.router:semantic-router:route:fallback',
          to: 'routing.fallback:imported-fallback',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'cascade.tier.uses_fallback',
          from: 'routing.cascade:imported-cascade:tier:1',
          to: 'routing.fallback:imported-fallback',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'fallback.option.uses_agent',
          from: 'routing.fallback:imported-fallback:option:1',
          to: 'agent:writer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'fallback.option.uses_prompt',
          from: 'routing.fallback:imported-fallback:option:2',
          to: 'prompt:writer-prompt',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'agent.uses_routing',
          from: 'agent:orchestrator',
          to: 'routing.router:semantic-router',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'flow.step.uses_routing',
          from: 'flow.step:routed-flow:route',
          to: 'routing.router:semantic-router',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'parallel.branch.uses_routing',
          from: 'composition.parallel:routedParallel:branch:routed',
          to: 'routing.router:semantic-router',
          fidelity: 'resolved',
        }),
      ]),
    )
    expect(
      snapshot.definitions.find((definition) => definition.id === 'routing.router:semantic-router')?.sourceRefs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'callback',
          property: 'classify',
          symbol: 'classifyRoute',
        }),
      ]),
    )
    expect(
      snapshot.definitions.find((definition) => definition.id === 'routing.cascade:imported-cascade:tier:1')
        ?.sourceRefs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'callback',
          property: 'evaluate',
          symbol: 'accepted',
        }),
      ]),
    )
    expect(
      snapshot.definitions.find((definition) => definition.id === 'routing.router:semantic-router:route:cascade'),
    ).toMatchObject({
      metadata: expect.objectContaining({
        targetKind: 'routing.cascade',
        targetDefinitionId: 'routing.cascade:imported-cascade',
      }),
    })
  })

  it('reports index lints for unstable or incomplete routing definitions', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'routing.ts'),
      `
        import { cascade, fallback, router } from '@crux/core/routing'

        export const badRouter = router({
          classify: () => 'cheap',
          routes: {
            cheap: missingModel,
          },
        })

        export const badCascade = cascade({
          tiers: [
            { model: 'cheap' },
            { model: 'expensive' },
          ],
        })

        export const badFallback = fallback('primary', 'backup')
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'routing-lints', staticOnly: true })

    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'routing.missing_stable_id',
          relatedDefinitionIds: ['routing.router:badRouter'],
        }),
        expect.objectContaining({
          ruleId: 'routing.router_missing_default',
          relatedDefinitionIds: ['routing.router:badRouter'],
        }),
        expect.objectContaining({
          ruleId: 'routing.unresolved_target',
          relatedDefinitionIds: ['routing.router:badRouter:route:cheap'],
        }),
        expect.objectContaining({
          ruleId: 'routing.cascade_unreachable_tier',
          relatedDefinitionIds: ['routing.cascade:badCascade', 'routing.cascade:badCascade:tier:1'],
        }),
        expect.objectContaining({
          ruleId: 'routing.missing_stable_id',
          relatedDefinitionIds: ['routing.fallback:badFallback'],
        }),
      ]),
    )
  })

  it('honors the off lint profile from crux config', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        export default config({
          prompts: [],
          tools: [{ name: 'searchDocs', description: 'Search docs' }],
          lint: { profile: 'off' },
        })
      `,
    )

    const snapshot = await indexProject({ root, projectName: 'lint-off' })
    expect(snapshot.lintFindings).toEqual([])
    expect(snapshot.ruleDescriptors).toContainEqual(
      expect.objectContaining({
        id: 'prompt.missing_input_schema',
        source: 'builtin',
      }),
    )
  })

  it('discovers memory and blackboard definitions authored inside factory functions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/memory.ts'),
      `
        import { z } from 'zod'
        import { blackboard } from '@crux/core/agent'
        import { episodes, facts, memory, workingState } from '@crux/core/memory'
        import { cruxConvexStore } from '@crux/convex'

        const threadBlackboardSchema = z.object({
          decisions: z.array(z.string()).default([]),
          intent: z.enum(['create', 'edit']).optional(),
        })
        const sessionSchema = z.object({ userIntent: z.string().optional() })

        function createMemoryId(type: 'session' | 'semantic' | 'episodic' | 'blackboard', ...parts: string[]) {
          const prefixes = { session: 'session', semantic: 'project-knowledge', episodic: 'user-episodes', blackboard: 'thread' }
          return prefixes[type] + ':' + parts.join(':')
        }

        export function createThreadBlackboard(sessionId: string, ctx: unknown) {
          return blackboard({
            id: createMemoryId('blackboard', sessionId),
            schema: threadBlackboardSchema,
            store: cruxConvexStore({ ctx }),
          })
        }

        export function createSessionMemory(threadId: string, ctx: unknown) {
          const store = cruxConvexStore({ ctx })
          const memoryId = createMemoryId('session', threadId)
          const state = workingState({ id: 'state', schema: sessionSchema })
          return memory({ id: memoryId, store, blocks: [state] })
        }

        export function createUserEpisodicMemory(userId: string, projectId: string, ctx: unknown) {
          const store = cruxConvexStore({ ctx })
          const memoryId = createMemoryId('episodic', userId, projectId)
          const history = episodes({ id: 'episodes' })
          return memory({ id: memoryId, store, blocks: [history], processing: { mode: 'inline' } })
        }

        export function createProjectSemanticMemory(projectId: string, ctx: unknown) {
          const store = cruxConvexStore({ ctx })
          const memoryId = createMemoryId('semantic', projectId)
          const knowledge = facts({ id: 'facts' })
          return memory({ id: memoryId, store, blocks: [knowledge] })
        }
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('blackboard:thread')).toMatchObject({
      kind: 'blackboard',
      name: 'thread:*',
      source: expect.objectContaining({ file: join(root, 'src/memory.ts'), line: expect.any(Number) }),
      metadata: expect.objectContaining({
        runtimeIdPrefix: 'thread:',
        backend: 'cruxConvexStore',
        schema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            decisions: expect.objectContaining({ type: 'array' }),
            intent: expect.objectContaining({ enum: ['create', 'edit'] }),
          }),
        }),
      }),
    })
    expect(byId.get('memory:session')?.metadata).toEqual(
      expect.objectContaining({
        runtimeIdPrefix: 'session:',
        backend: 'cruxConvexStore',
        schema: expect.objectContaining({
          properties: expect.objectContaining({ userIntent: expect.objectContaining({ type: 'string' }) }),
        }),
        blocks: [expect.objectContaining({ id: 'state', kind: 'working' })],
      }),
    )
    expect(byId.get('memory.block:session:state')).toMatchObject({
      kind: 'memory.block',
      metadata: expect.objectContaining({ memoryId: 'memory:session', blockKind: 'working' }),
    })
    expect(byId.get('memory:user-episodes')?.metadata).toEqual(
      expect.objectContaining({
        runtimeIdPrefix: 'user-episodes:',
        backend: 'cruxConvexStore',
        schema: expect.objectContaining({ name: 'EpisodicEntry', type: 'object' }),
        blocks: [
          expect.objectContaining({
            id: 'episodes',
            kind: 'episodes',
            schema: expect.objectContaining({ name: 'EpisodicEntry' }),
          }),
        ],
      }),
    )
    expect(byId.get('memory:project-knowledge')?.metadata).toEqual(
      expect.objectContaining({
        runtimeIdPrefix: 'project-knowledge:',
        backend: 'cruxConvexStore',
        schema: expect.objectContaining({ name: 'SemanticFact', type: 'object' }),
        blocks: [
          expect.objectContaining({
            id: 'facts',
            kind: 'facts',
            schema: expect.objectContaining({ name: 'SemanticFact' }),
          }),
        ],
      }),
    )
    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'memory.long_lived_without_retention',
          relatedDefinitionIds: ['memory:user-episodes'],
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'definition',
              label: 'Long-lived memory has no retention policy',
            }),
          ]),
        }),
        expect.objectContaining({
          ruleId: 'memory.long_lived_without_retention',
          relatedDefinitionIds: ['memory:project-knowledge'],
        }),
      ]),
    )
  })

  it('honors index lint suppression comments and reports stale suppressions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/tools.ts'),
      `
        import { createTool } from '@crux/core/tool'

        // crux-lint-disable-next-line tool.missing_input_schema -- generated external adapter
        export const ignoredTool = createTool({ name: 'ignoredTool', description: 'No schema' })

        // crux-lint-disable-next-line tool.missing_input_schema -- stale suppression
        export const typedTool = createTool({ name: 'typedTool', description: 'Typed', parameters: z.object({ query: z.string() }) })

        // crux-lint-disable-next-line tool.not_a_rule -- typo
        export const noisyTool = createTool({ name: 'noisyTool', description: 'No schema' })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })

    expect(snapshot.lintFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'tool.missing_input_schema', relatedDefinitionIds: ['tool:ignoredTool'] }),
      ]),
    )
    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'tool.missing_input_schema', relatedDefinitionIds: ['tool:noisyTool'] }),
      ]),
    )
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'index.lint_unused_suppression' }),
        expect.objectContaining({ code: 'index.lint_unknown_suppression_rule' }),
      ]),
    )
  })

  it('does not treat conventional unit test files as authored index definitions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src/__tests__'), { recursive: true })
    await writeFile(
      join(root, 'src/__tests__/agentContexts.test.ts'),
      `
        import { prompt } from '@crux/core'
        const testPrompt = prompt({ id: 'test-only', prompt: 'Only for a unit test' })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })

    expect(snapshot.definitions.some((definition) => definition.id === 'prompt:test-only')).toBe(false)
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.source?.file.includes('__tests__'))).toBe(false)
  })

  it('discovers authored primitive graphs inside factory functions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/factory.ts'),
      `
        import { prompt, workspace } from '@crux/core'
        import { agent } from '@crux/core/agent'
        import { flow } from '@crux/core/flow'
        import { parallel, pipeline, swarm, consensus } from '@crux/core/agent'
        import { createTool } from '@crux/core/tool'

        export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })
        export const searchDocs = createTool({ name: 'searchDocs', description: 'Search docs' })

        export function createWriterGraph() {
          const writerAgent = agent({
            id: 'writer-agent',
            prompt: writerPrompt,
            tools: [searchDocs],
            handoffs: ['reviewer-agent'],
          })
          const writerWorkspace = workspace({
            id: 'writer-space',
            namespace: 'thread:1',
            mounts: [{ path: '/drafts', access: 'readwrite' }],
          })
          const writerFlow = flow('writer-flow', async (flow) => {
            await flow.step('draft', async () => 'drafted')
            return flow.step('review', async () => 'reviewed')
          })
          const writerParallel = parallel({ context: {}, agents: { writer: writerAgent } })
          const writerPipeline = pipeline({ context: {}, steps: [{ name: 'write', agent: writerAgent }] })
          const writerConsensus = consensus({ input: {}, agents: [writerAgent], extract: () => 'ok' })
          const writerSwarm = swarm({ input: {}, startAgent: 'writer-agent', agents: { 'writer-agent': writerAgent } })
          return { writerAgent, writerWorkspace, writerFlow, writerParallel, writerPipeline, writerConsensus, writerSwarm }
        }
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('agent:writer-agent')).toMatchObject({ kind: 'agent', name: 'writer-agent' })
    expect(byId.get('workspace:writer-space')).toMatchObject({ kind: 'workspace', name: 'writer-space' })
    expect(byId.get('workspace:writer-space')?.metadata).toEqual(
      expect.objectContaining({
        namespace: 'thread:1',
        mounts: [expect.objectContaining({ path: '/drafts', access: 'readwrite' })],
      }),
    )
    expect(byId.get('flow:writer-flow')).toMatchObject({ kind: 'flow', name: 'writer-flow' })
    expect(byId.get('flow.step:writer-flow:draft')).toMatchObject({ kind: 'flow.step', name: 'draft' })
    expect(byId.get('flow.step:writer-flow:review')).toMatchObject({ kind: 'flow.step', name: 'review' })
    expect(byId.get('composition.parallel:writerParallel')).toMatchObject({ kind: 'composition.parallel' })
    expect(byId.get('composition.pipeline:writerPipeline')).toMatchObject({ kind: 'composition.pipeline' })
    expect(byId.get('composition.consensus:writerConsensus')).toMatchObject({ kind: 'composition.consensus' })
    expect(byId.get('composition.swarm:writerSwarm')).toMatchObject({ kind: 'composition.swarm' })
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:writer-agent', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:writer-agent', to: 'tool:searchDocs' }),
        expect.objectContaining({
          type: 'flow.includes_step',
          from: 'flow:writer-flow',
          to: 'flow.step:writer-flow:draft',
        }),
        expect.objectContaining({
          type: 'flow.includes_step',
          from: 'flow:writer-flow',
          to: 'flow.step:writer-flow:review',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.parallel:writerParallel',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.pipeline:writerPipeline',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.consensus:writerConsensus',
          to: 'agent:writer-agent',
        }),
        expect.objectContaining({
          type: 'composition.uses_agent',
          from: 'composition.swarm:writerSwarm',
          to: 'agent:writer-agent',
        }),
      ]),
    )
  })

  it('upgrades import-safe rich primitive exports to resolved index definitions', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/import-safe.agent.ts'),
      `
        import { z } from 'zod'
        import { context, prompt } from '@crux/core'
        import { agent, blackboard } from '@crux/core/agent'
        import { flow } from '@crux/core/flow'
        import { memory } from '@crux/core/memory'
        import { retriever, retrievalPipeline, retrievalStage } from '@crux/core/retrieval'
        import { constraint } from '@crux/core/safety'
        import { guardrail } from '@crux/core/safety'
        import { llmJudge } from '@crux/core/scoring'

        export const brand = context({ id: 'brand', system: 'Brand voice' })
        export const safeTone = constraint({ name: 'safe-tone', severity: 'assert', check: () => ({ pass: true }) })
        export const outputGuard = guardrail({ name: 'output-guard', phase: 'output', validate: () => ({ action: 'pass' }) })
        const promptSafety = [safeTone]
        export const writerPrompt = prompt({ id: 'writer', use: [brand], constraints: promptSafety, prompt: 'Write' })
        const agentSafety = [outputGuard]
        export const writerAgent = agent({
          id: 'writer-agent',
          description: 'Writes drafts',
          prompt: writerPrompt,
          guardrails: agentSafety,
          handoffs: [{ id: 'reviewer-agent', when: 'Needs review' }],
        })
        export const writerFlow = flow('writer-flow', async (flow) => flow.step('draft', async () => 'done'))
        export const docsRetriever = retriever({ id: 'docs', namespace: 'kb', retrieve: async () => [] })
        export const queryStage = retrievalStage({ name: 'rewrite', phase: 'query', run: ({ query }) => ({ query }) })
        export const docsRag = retrievalPipeline(docsRetriever, [queryStage])
        export const sessionMemory = memory({ id: 'session-memory', blocks: [] })
        export const notes = blackboard({ id: 'notes', schema: z.object({ summary: z.string().optional() }) })
        export const factuality = llmJudge({
          id: 'factuality',
          criteria: 'Be factual',
          model: 'judge-model',
          threshold: 0.75,
          temperature: 0,
          samples: 1,
          scale: { min: 0, max: 1 },
          settings: { temperature: 0, samples: 1 },
          rubric: { 1: 'weak' },
          detailSchema: z.object({ notes: z.string() }),
          chainOfThought: true,
        })
      `,
    )

    const snapshot = await indexProject({ root })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('agent:writer-agent')).toMatchObject({
      kind: 'agent',
      fidelity: 'resolved',
      source: expect.objectContaining({ line: expect.any(Number) }),
      metadata: expect.objectContaining({
        promptId: 'writer',
        handoffs: [{ id: 'reviewer-agent', when: 'Needs review' }],
      }),
    })
    expect(byId.get('flow:writer-flow')).toMatchObject({ kind: 'flow', fidelity: 'resolved' })
    expect(byId.get('rag.retriever:docs')).toMatchObject({
      kind: 'rag.retriever',
      fidelity: 'resolved',
      metadata: expect.objectContaining({ namespace: 'kb' }),
    })
    expect(byId.get('rag.pipeline:docsRag')).toMatchObject({
      kind: 'rag.pipeline',
      fidelity: 'resolved',
      metadata: expect.objectContaining({ retrieverId: 'docs', stageNames: ['rewrite'] }),
    })
    expect(byId.get('memory:session-memory')).toMatchObject({ kind: 'memory', fidelity: 'resolved' })
    expect(byId.get('blackboard:notes')).toMatchObject({ kind: 'blackboard', fidelity: 'resolved' })
    expect(byId.get('constraint:safe-tone')).toMatchObject({
      kind: 'constraint',
      fidelity: 'resolved',
      metadata: expect.objectContaining({
        severity: 'assert',
        facts: expect.objectContaining({ kind: 'constraint', severity: 'assert' }),
      }),
    })
    expect(byId.get('guardrail:output-guard')).toMatchObject({
      kind: 'guardrail',
      fidelity: 'resolved',
      metadata: expect.objectContaining({
        phase: 'output',
        facts: expect.objectContaining({ kind: 'guardrail', policy: 'output' }),
      }),
    })
    expect(byId.get('scorer:factuality')).toMatchObject({
      kind: 'scorer',
      fidelity: 'resolved',
      metadata: expect.objectContaining({
        facts: expect.objectContaining({
          kind: 'scorer',
          scorerId: 'factuality',
          model: 'judge-model',
          threshold: 0.75,
          scaleMin: 0,
          scaleMax: 1,
          hasRubric: true,
          hasDetailSchema: true,
          chainOfThought: true,
          criteriaPreview: 'Be factual',
        }),
        configuration: expect.objectContaining({
          model: 'judge-model',
          threshold: 0.75,
          temperature: 0,
          samples: 1,
          scale: { min: 0, max: 1 },
          rubric: true,
          detailSchema: true,
          chainOfThought: true,
          settings: { temperature: 0, samples: 1 },
        }),
        settings: { temperature: 0, samples: 1 },
      }),
    })
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.uses_prompt',
          from: 'agent:writer-agent',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'agent.can_handoff_to',
          from: 'agent:writer-agent',
          to: 'agent:reviewer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'constraint.applies_to',
          from: 'constraint:safe-tone',
          to: 'prompt:writer',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'guardrail.applies_to',
          from: 'guardrail:output-guard',
          to: 'agent:writer-agent',
          fidelity: 'resolved',
        }),
        expect.objectContaining({
          type: 'rag.pipeline.uses_retriever',
          from: 'rag.pipeline:docsRag',
          to: 'rag.retriever:docs',
          fidelity: 'resolved',
        }),
      ]),
    )
  })

  it('preserves caller CRUX_INDEX while concurrent project indexes import modules', async () => {
    const rootA = await fixtureRoot()
    const rootB = await fixtureRoot()
    for (const root of [rootA, rootB]) {
      await writeFile(
        join(root, 'crux.config.ts'),
        `
          import { config, prompt } from '@crux/core'
          export const writer = prompt({ id: 'writer', prompt: 'Write' })
          export default config({ prompts: [writer] })
        `,
      )
    }

    const previous = process.env.CRUX_INDEX
    process.env.CRUX_INDEX = 'outer'
    try {
      const [a, b] = await Promise.all([indexProject({ root: rootA }), indexProject({ root: rootB })])
      expect(process.env.CRUX_INDEX).toBe('outer')
      expect(a.definitions.some((definition) => definition.id === 'prompt:writer')).toBe(true)
      expect(b.definitions.some((definition) => definition.id === 'prompt:writer')).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.CRUX_INDEX
      else process.env.CRUX_INDEX = previous
    }
  })

  it('plans file-delta indexing as an explicit full reindex until dependencies are materialized', async () => {
    const root = await fixtureRoot()
    const previousIndex = await indexProject({ root, staticOnly: true })

    const decision = planIndexFiles({
      root,
      previousIndex,
      files: ['src/b.ts', 'src/a.ts', 'src/a.ts'],
    })

    expect(decision).toEqual({
      kind: 'full-reindex-required',
      reason: 'missing-source-graph',
      root,
      files: [join(root, 'src/a.ts'), join(root, 'src/b.ts')],
      changedFiles: [join(root, 'src/a.ts'), join(root, 'src/b.ts')],
      deletedFiles: [],
      graphConfidence: 'missing-source-graph',
      previousIndexDefinitionCount: previousIndex.definitions.length,
      explanation: {
        summary: 'Previous index snapshot did not contain source graph rows.',
        graphAvailable: false,
        fallbackUsed: true,
        traversedFiles: [],
      },
    })
  })

  it('captures deterministic static dependencies for relative imports', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const dependencyFile = join(root, 'src/prompt.ts')
    const indexFile = join(root, 'src/index.ts')
    await writeFile(
      dependencyFile,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer', prompt: 'Write' })
      `,
    )
    await writeFile(
      indexFile,
      `
        import { createPrompts } from '@crux/core'
        import { writer } from './prompt'
        import { z } from 'zod'
        export const prompts = createPrompts({ writer })
      `,
    )

    const parsed = await createStaticExtraction({ root, cache: 'none' }).extractFile(indexFile)

    expect(parsed.dependencies).toEqual([dependencyFile])
    expect(
      parsed.definitions.some(
        (definition) => definition.id === 'prompt:writer' && definition.path?.join('/') === 'writer',
      ),
    ).toBe(true)
  })

  it('resolves tsconfig path aliases for static dependencies and authored paths', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src/prompts'), { recursive: true })
    const dependencyFile = join(root, 'src/prompts/writer.ts')
    const indexFile = join(root, 'src/index.ts')
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
      }),
    )
    await writeFile(
      dependencyFile,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer', prompt: 'Write' })
      `,
    )
    await writeFile(
      indexFile,
      `
        import { createPrompts } from '@crux/core'
        import { writer } from '@/prompts/writer'
        export const prompts = createPrompts({ agent: { writer } })
      `,
    )

    const parsed = await createStaticExtraction({ root, cache: 'none' }).extractFile(indexFile)

    expect(parsed.dependencies).toEqual([dependencyFile])
    expect(
      parsed.definitions.some(
        (definition) => definition.id === 'prompt:writer' && definition.path?.join('/') === 'agent/writer',
      ),
    ).toBe(true)
  })

  it('projects source files with produced definitions, dependencies, and dependents', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const dependencyFile = join(root, 'src/prompt.ts')
    const indexFile = join(root, 'src/index.ts')
    await writeFile(
      dependencyFile,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer', prompt: 'Write' })
      `,
    )
    await writeFile(
      indexFile,
      `
        import { createPrompts } from '@crux/core'
        import { writer } from './prompt'
        export const prompts = createPrompts({ writer })
      `,
    )

    const snapshot = await indexProject({ root, staticOnly: true })
    const sourceByFile = new Map(snapshot.sources.map((source) => [source.file, source]))

    expect(sourceByFile.get(dependencyFile)).toEqual(
      expect.objectContaining({
        definitionIds: expect.arrayContaining(['prompt:writer']),
        dependents: expect.arrayContaining([indexFile]),
      }),
    )
    expect(sourceByFile.get(indexFile)).toEqual(
      expect.objectContaining({
        dependencies: expect.arrayContaining([dependencyFile]),
      }),
    )
  })

  it('invalidates static parse cache when a direct dependency changes', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const dependencyFile = join(root, 'src/prompt.ts')
    const indexFile = join(root, 'src/index.ts')
    await writeFile(
      dependencyFile,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer-v1', prompt: 'Write' })
      `,
    )
    await writeFile(
      indexFile,
      `
        import { createPrompts } from '@crux/core'
        import { writer } from './prompt'
        export const prompts = createPrompts({ writer })
      `,
    )

    const first = await createStaticExtraction({ root }).extractFile(indexFile)
    await writeFile(
      dependencyFile,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer-v2', prompt: 'Write' })
      `,
    )
    const second = await createStaticExtraction({ root }).extractFile(indexFile)

    expect(first.definitions.some((definition) => definition.id === 'prompt:writer-v1')).toBe(true)
    expect(second.definitions.some((definition) => definition.id === 'prompt:writer-v2')).toBe(true)
    expect(second.definitions.some((definition) => definition.id === 'prompt:writer-v1')).toBe(false)
  })

  it('invalidates static parse cache when extension identity changes', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const indexFile = join(root, 'src/index.ts')
    await writeFile(
      indexFile,
      `
        export const writer = customPrompt()
      `,
    )

    const first = await createStaticExtraction({ root, extensions: [customPromptExtension('v1')] }).extractFile(
      indexFile,
    )
    const second = await createStaticExtraction({ root, extensions: [customPromptExtension('v2')] }).extractFile(
      indexFile,
    )

    expect(first.definitions.map((definition) => definition.id)).toContain('prompt:v1')
    expect(second.definitions.map((definition) => definition.id)).toContain('prompt:v2')
    expect(second.definitions.map((definition) => definition.id)).not.toContain('prompt:v1')
  })

  it('invalidates semantic facts cache when a referenced schema source changes', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const contractsFile = join(root, 'src/contracts.ts')
    await writeFile(
      contractsFile,
      `
        import { z } from 'zod'
        export const ToolParams = z.object({ query: z.string() })
      `,
    )
    await writeFile(
      join(root, 'src/tool.ts'),
      `
        import { tool } from '@crux/core'
        import { ToolParams } from './contracts'
        export const searchDocs = tool({ name: 'searchDocs', parameters: ToolParams })
      `,
    )

    const first = await indexProjectSemantic({ root, projectName: 'semantic-cache' })
    const firstTool = first.facts.definitions?.find((definition) => definition.id === 'tool:searchDocs')
    expect(firstTool?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ query: expect.objectContaining({ type: 'string' }) }),
      }),
    )
    const cacheDirs = await readdir(join(root, '.crux/cache/index'))
    expect(cacheDirs.some((entry) => entry.startsWith('semantic-facts-'))).toBe(true)

    await writeFile(
      contractsFile,
      `
        import { z } from 'zod'
        export const ToolParams = z.object({ topic: z.string() })
      `,
    )

    const second = await indexProjectSemantic({ root, projectName: 'semantic-cache' })
    const secondTool = second.facts.definitions?.find((definition) => definition.id === 'tool:searchDocs')
    expect(secondTool?.metadata?.inputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ topic: expect.objectContaining({ type: 'string' }) }),
      }),
    )
    expect(secondTool?.metadata?.inputSchema).not.toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ query: expect.anything() }),
      }),
    )
  }, 15_000)
})

function customPromptExtension(version: string): IndexerExtension {
  return {
    name: '@acme/custom-prompts',
    version,
    extractors: [
      {
        name: 'customPrompt',
        patterns: [{ kind: 'call', name: 'customPrompt' }],
        extract: (ctx) =>
          facts({
            definitions: [
              ctx.define.definition({
                variableName: ctx.source.variableName,
                id: `prompt:${version}`,
                kind: 'prompt' as ProjectDefinitionKind,
                name: version,
              }),
            ],
          }),
      },
    ],
  }
}
