import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject } from '../index'
import { planIndexFiles } from '../indexer/incremental'
import { staticDefinitionFiles } from '../indexer/files'
import { parseStaticDefinitions } from '../indexer/static-file'
import { parseStaticDefinitionsCached } from '../indexer/static-cache'
import { staticFileParser } from '../indexer/static-parser'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-catalog-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project indexer', () => {
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
    await writeFile(
      join(root, 'src/pdfExportWasm.ts'),
      `export const pdfExportWasm = "${'A'.repeat(1_200_000)}";`,
    )

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
        code: 'catalog.source_too_large',
        severity: 'warning',
        source: expect.objectContaining({ file: join(root, 'src/huge-authored.ts') }),
      }),
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
          eval: {
            include: 'evals/**/*.eval.ts',
            suiteInclude: ['evals/**/*.suite.ts', '.crux/quality/**/*.json'],
            setup: async () => ({ generate: undefined as never, models: {} }),
          },
        })
      `,
    )

    await writeFile(
      join(root, 'evals/writer.eval.ts'),
      `
        import { evaluation } from '@crux/core/testing'
        import { writerPrompt } from '../crux.config'

        export const WriterEval = evaluation({
          prompt: writerPrompt,
          mode: 'text',
          cases: [{ name: 'basic', input: { topic: 'Launch' }, assert: () => true }],
        })
      `,
    )

    await writeFile(
      join(root, 'evals/writer.suite.ts'),
      `
        import { suite } from '@crux/core/quality'

        export const writerSuite = suite('writer-suite', (test) => {
          test('draft title', { input: { topic: 'Launch' }, expected: { title: 'Launch' } })
        })
      `,
    )

    await writeFile(
      join(root, '.crux/quality/suites/json-suite.json'),
      JSON.stringify({
        id: 'json-suite',
        description: 'Portable suite',
        cases: [{ id: 'case-1', name: 'Case one', input: { topic: 'A' } }],
      }),
    )

    const snapshot = await indexProject({ root, projectName: 'fixture' })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(snapshot.project).toMatchObject({ root, name: 'fixture', configFile: join(root, 'crux.config.ts') })
    expect(byId.get('prompt:writer.prompt')).toMatchObject({ kind: 'prompt', fidelity: 'resolved', name: 'writer.prompt' })
    expect(byId.get('context:brand.voice')).toMatchObject({ kind: 'context', fidelity: 'resolved', name: 'brand.voice' })
    expect(byId.get('tool:searchDocs')).toMatchObject({ kind: 'tool', fidelity: 'resolved', name: 'searchDocs' })
    expect(byId.get('prompt:writer.prompt')?.source).toEqual(expect.objectContaining({ file: join(root, 'crux.config.ts'), line: expect.any(Number) }))
    expect(byId.get('context:brand.voice')?.source).toEqual(expect.objectContaining({ file: join(root, 'crux.config.ts'), line: expect.any(Number) }))
    expect(byId.get('tool:searchDocs')?.source).toEqual(expect.objectContaining({ file: join(root, 'crux.config.ts'), line: expect.any(Number) }))
    expect(byId.get('eval.prompt:WriterEval')).toMatchObject({ kind: 'eval.prompt', fidelity: 'resolved', name: 'writer.prompt' })
    expect(byId.get('suite:writer-suite')).toMatchObject({ kind: 'suite', fidelity: 'resolved', name: 'writer-suite' })
    expect(byId.get('suite:json-suite')).toMatchObject({ kind: 'suite', fidelity: 'resolved', name: 'json-suite' })
    expect(byId.get('suite.case:json-suite:case-1')).toMatchObject({ kind: 'suite.case', name: 'Case one' })
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
    expect(snapshot.relations.some((relation) => relation.type === 'prompt.uses_context' && relation.from === 'prompt:writer.prompt' && relation.to === 'context:brand.voice')).toBe(true)
    expect(snapshot.relations.some((relation) => relation.type === 'eval.targets_prompt' && relation.from === 'eval.prompt:WriterEval' && relation.to === 'prompt:writer.prompt')).toBe(true)
    expect(snapshot.relations.some((relation) => relation.type === 'suite.includes_case' && relation.from === 'suite:json-suite' && relation.to === 'suite.case:json-suite:case-1')).toBe(true)

    const snapshotAgain = await indexProject({ root, projectName: 'fixture' })
    expect(snapshotAgain.definitions.map((definition) => definition.id)).toEqual(snapshot.definitions.map((definition) => definition.id))
    expect(snapshotAgain.relations.map((relation) => relation.id)).toEqual(snapshot.relations.map((relation) => relation.id))
    expect(snapshotAgain.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(snapshot.diagnostics.map((diagnostic) => diagnostic.id))
    expect(snapshotAgain.lintFindings.map((finding) => finding.id)).toEqual(snapshot.lintFindings.map((finding) => finding.id))
  })

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
        import { evaluation } from '@crux/core/testing'

        throw new Error('eval import side effect')

        export const brokenEval = evaluation({
          prompt: {} as never,
          mode: 'text',
          cases: [],
        })
      `,
    )

    const snapshot = await indexProject({ root })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('prompt:static.prompt')).toMatchObject({ kind: 'prompt', fidelity: 'partial', name: 'static.prompt' })
    expect(byId.get('context:static.context')).toMatchObject({ kind: 'context', fidelity: 'partial', name: 'static.context' })
    expect(byId.get('eval.prompt:brokenEval')).toMatchObject({ kind: 'eval.prompt', fidelity: 'partial', name: 'brokenEval' })
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
        fidelity: 'partial',
      }),
    )
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'catalog.config_not_found' }),
        expect.objectContaining({ code: 'catalog.module_import_failed' }),
      ]),
    )
    expect(snapshot.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'catalog.static_partial' })]),
    )
    expect(snapshot.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'catalog.rich_import_failed',
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
        expect.objectContaining({ type: 'prompt.uses_context', from: 'prompt:array', to: 'context:prosemirror-schema' }),
      ]),
    )
  })

  it('does not invent authored paths for dynamic hierarchy leaves and keeps best-effort Zod metadata', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'catalog.ts'),
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
          source: expect.objectContaining({ file: join(root, 'src/tools.ts'), line: expect.any(Number), function: 'localExecute' }),
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
          source: expect.objectContaining({ file: join(root, 'src/shared.ts'), line: expect.any(Number), function: 'importedExecute' }),
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
      expect.arrayContaining([
        expect.objectContaining({ role: 'system', property: 'system', symbol: 'staticSystem' }),
      ]),
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
    expect(safe?.sourceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'policy', property: 'check', symbol: 'policyCheck' })]))
    expect(judge?.sourceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'validator', property: 'score', symbol: 'judgeScore' })]))
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
        expect.objectContaining({ type: 'flow.step.writes_blackboard', from: 'flow.step:writer-flow:draft', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'prompt.reads_blackboard', from: 'prompt:writer-prompt', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'context.reads_blackboard', from: 'context:active-context', to: 'blackboard:notes' }),
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
        import { flow as cruxFlow } from '@crux/convex/server'
        import { Agent } from '@crux/convex/agent'
        import { memory, workingState } from '@crux/core/memory'
        import { retriever, retrievalPipeline } from '@crux/core/retrieval'
        import { constraint } from '@crux/core/safety/constraint'
        import { guardrail } from '@crux/core/safety/guardrail'
        import { llmJudge } from '@crux/core/scoring'
        import { evaluation, flowEvaluation, ragEvaluation } from '@crux/core/eval'
        import { createTool } from '@crux/core/tool'
        import type { FlowToolDef } from '@crux/core/testing'
        import { z } from 'zod'

        export const brand = context({ id: 'brand', system: 'Brand voice' })
        export const writerPrompt = prompt({ id: 'writer', use: [brand], prompt: 'Write' })
        export const searchDocs = createTool({
          name: 'searchDocs',
          description: 'Search docs',
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
        export const factuality = llmJudge({ id: 'factuality', criteria: 'Be factual', scale: { min: 0, max: 1 } })
        export const writerEval = evaluation({ name: 'writer-eval', prompt: writerPrompt })
        export const writerFlowEval = flowEvaluation({ name: 'writer-flow-eval', flow: writerFlow })
        export const docsRagEval = ragEvaluation({ id: 'docs-rag-eval', rag: docsRag })
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
        intelligence: expect.objectContaining({
          confidence: 'static',
          dependencies: expect.objectContaining({
            prompt: 'writerPrompt',
            tools: ['searchDocs'],
            handoffs: ['reviewer-agent'],
          }),
          data: expect.objectContaining({
            reads: expect.arrayContaining([
              expect.objectContaining({ targetVariable: 'sessionMemory', key: 'profile' }),
              expect.objectContaining({ targetVariable: 'scratch', key: '/brand.md' }),
            ]),
            writes: [expect.objectContaining({ targetVariable: 'notes', key: 'activeAgent' })],
          }),
        }),
      }),
    )
    expect(byId.get('tool:calculator')).toMatchObject({ kind: 'tool', name: 'calculator' })
    expect(byId.get('tool:searchDocs')?.metadata).toEqual(
      expect.objectContaining({
        intelligence: expect.objectContaining({
          confidence: 'static',
          data: expect.objectContaining({
            reads: [expect.objectContaining({ targetVariable: 'sessionMemory', key: 'query' })],
            writes: [expect.objectContaining({ targetVariable: 'notes', key: 'lastSearch' })],
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
        intelligence: expect.objectContaining({
          confidence: 'static',
          data: expect.objectContaining({
            reads: [expect.objectContaining({ targetVariable: 'sessionMemory', key: 'draft' })],
            writes: expect.arrayContaining([
              expect.objectContaining({ targetVariable: 'notes', key: 'summary' }),
              expect.objectContaining({ targetVariable: 'scratch', key: '/draft.md' }),
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
          stepId: 'draft',
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
        scorerVariable: 'factuality',
      }),
    })
    expect(byId.get('memory:session-memory')).toMatchObject({ kind: 'memory', name: 'session-memory' })
    expect(byId.get('memory.store:session-memory:memoryStore')).toMatchObject({
      kind: 'memory.store',
      name: 'memoryStore',
      metadata: expect.objectContaining({
        backend: 'cruxConvexStore',
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
        runtimeJoin: expect.objectContaining({
          definitionId: 'memory.block:session-memory:state',
          blockId: 'state',
          memoryId: 'memory:session-memory',
        }),
        schema: expect.objectContaining({ type: 'object' }),
      }),
    })
    expect(byId.get('blackboard:notes')).toMatchObject({ kind: 'blackboard', name: 'notes' })
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
    expect(byId.get('eval.prompt:writer-eval')).toMatchObject({
      kind: 'eval.prompt',
      metadata: expect.objectContaining({ covers: ['writerPrompt'] }),
    })
    expect(byId.get('eval.flow:writer-flow-eval')).toMatchObject({
      kind: 'eval.flow',
      metadata: expect.objectContaining({ covers: ['writerFlow'] }),
    })
    expect(byId.get('eval.rag:docs-rag-eval')).toMatchObject({
      kind: 'eval.rag',
      metadata: expect.objectContaining({ covers: ['docsRag'] }),
    })
    expect(byId.get('composition.parallel:writerParallel')).toMatchObject({ kind: 'composition.parallel' })
    expect(byId.get('composition.parallel:writerParallel:branch:writer')).toMatchObject({
      kind: 'composition.parallel.branch',
      name: 'writer',
      metadata: expect.objectContaining({
        compositionId: 'composition.parallel:writerParallel',
        branchId: 'writer',
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
        expect.objectContaining({ type: 'agent.reads_memory', from: 'agent:writer-agent', to: 'memory:session-memory' }),
        expect.objectContaining({ type: 'agent.writes_blackboard', from: 'agent:writer-agent', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'agent.reads_workspace', from: 'agent:writer-agent', to: 'workspace:scratch' }),
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:Karyla', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:Karyla', to: 'tool:searchDocs' }),
        expect.objectContaining({ type: 'agent.can_handoff_to', from: 'agent:writer-agent', to: 'agent:reviewer-agent' }),
        expect.objectContaining({ type: 'tool.reads_memory', from: 'tool:searchDocs', to: 'memory:session-memory' }),
        expect.objectContaining({ type: 'tool.writes_blackboard', from: 'tool:searchDocs', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'flow.includes_step', from: 'flow:writer-flow', to: 'flow.step:writer-flow:draft' }),
        expect.objectContaining({ type: 'flow.step.waits_for_signal', from: 'flow.step:writer-flow:draft', to: 'signal:draft-approved' }),
        expect.objectContaining({ type: 'flow.step.reads_memory', from: 'flow.step:writer-flow:draft', to: 'memory:session-memory' }),
        expect.objectContaining({ type: 'flow.step.writes_blackboard', from: 'flow.step:writer-flow:draft', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'flow.step.writes_workspace', from: 'flow.step:writer-flow:draft', to: 'workspace:scratch' }),
        expect.objectContaining({ type: 'flow.step.uses_agent', from: 'flow.step:agent-flow:draft', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'flow.step.uses_agent', from: 'flow.step:convex-writer:draft', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'flow.step.waits_for_signal', from: 'flow.step:convex-writer:draft', to: 'signal:plan-approval' }),
        expect.objectContaining({ type: 'rag.pipeline.uses_retriever', from: 'rag.pipeline:docsRag', to: 'rag.retriever:docs' }),
        expect.objectContaining({ type: 'rag.pipeline.includes_stage', from: 'rag.pipeline:docsRag', to: 'rag.pipeline:docsRag:stage:rerank' }),
        expect.objectContaining({ type: 'rag.pipeline.stage.uses_scorer', from: 'rag.pipeline:docsRag:stage:rerank', to: 'scorer:factuality' }),
        expect.objectContaining({ type: 'memory.includes_block', from: 'memory:session-memory', to: 'memory.block:session-memory:state' }),
        expect.objectContaining({ type: 'memory.uses_store', from: 'memory:session-memory', to: 'memory.store:session-memory:memoryStore' }),
        expect.objectContaining({ type: 'blackboard.uses_store', from: 'blackboard:notes', to: 'memory.store:notes:boardStore' }),
        expect.objectContaining({ type: 'workspace.exposes_tool', from: 'workspace:scratch', to: 'tool:searchDocs' }),
        expect.objectContaining({ type: 'workspace.mounts_path', from: 'workspace:scratch', to: 'workspace.path:scratch:workspace' }),
        expect.objectContaining({ type: 'constraint.applies_to', from: 'constraint:safe-tone', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'guardrail.applies_to', from: 'guardrail:output-guard', to: 'tool:searchDocs' }),
        expect.objectContaining({ type: 'eval.covers_definition', from: 'eval.prompt:writer-eval', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'eval.covers_definition', from: 'eval.flow:writer-flow-eval', to: 'flow:writer-flow' }),
        expect.objectContaining({ type: 'eval.covers_definition', from: 'eval.rag:docs-rag-eval', to: 'rag.pipeline:docsRag' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.parallel:writerParallel', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'parallel.includes_branch', from: 'composition.parallel:writerParallel', to: 'composition.parallel:writerParallel:branch:writer' }),
        expect.objectContaining({ type: 'parallel.branch.uses_agent', from: 'composition.parallel:writerParallel:branch:writer', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.pipeline:writerPipeline', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'pipeline.includes_stage', from: 'composition.pipeline:writerPipeline', to: 'composition.pipeline:writerPipeline:stage:write' }),
        expect.objectContaining({ type: 'pipeline.stage.uses_agent', from: 'composition.pipeline:writerPipeline:stage:write', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'pipeline.includes_stage', from: 'composition.pipeline:writerPipeline', to: 'composition.pipeline:writerPipeline:stage:outline' }),
        expect.objectContaining({ type: 'pipeline.stage.uses_prompt', from: 'composition.pipeline:writerPipeline:stage:outline', to: 'prompt:writer' }),
        expect.objectContaining({ type: 'pipeline.includes_stage', from: 'composition.pipeline:writerPipeline', to: 'composition.pipeline:writerPipeline:stage:search' }),
        expect.objectContaining({ type: 'pipeline.stage.uses_tool', from: 'composition.pipeline:writerPipeline:stage:search', to: 'tool:searchDocs' }),
        expect.objectContaining({ type: 'composition.uses_flow', from: 'composition.pipeline:flowPipeline', to: 'flow:agent-flow' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.consensus:writerConsensus', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'consensus.includes_agent', from: 'composition.consensus:writerConsensus', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'consensus.uses_scorer', from: 'composition.consensus:writerConsensus', to: 'scorer:factuality' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.swarm:writerSwarm', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'swarm.includes_agent', from: 'composition.swarm:writerSwarm', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'swarm.coordinated_by', from: 'composition.swarm:writerSwarm', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'swarm.uses_blackboard', from: 'composition.swarm:writerSwarm', to: 'blackboard:notes' }),
        expect.objectContaining({ type: 'swarm.uses_memory', from: 'composition.swarm:writerSwarm', to: 'memory:session-memory' }),
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
          ruleId: 'tool.missing_input_schema',
          category: 'contracts',
          maturity: 'stable',
          confidence: 'high',
          profiles: expect.arrayContaining(['recommended', 'strict']),
          relatedDefinitionIds: ['tool:searchDocs'],
          affectedDefinitionIds: expect.arrayContaining(['tool:searchDocs', 'agent:writer-agent']),
          severity: 'info',
          rationale: expect.stringContaining('schema'),
          impact: expect.stringContaining('tool'),
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'definition',
              definitionId: 'tool:searchDocs',
              label: 'Tool definition has no input schema',
            }),
          ]),
          fixes: expect.arrayContaining([
            expect.objectContaining({
              kind: 'manual',
              title: 'Declare tool parameters',
            }),
            expect.objectContaining({
              kind: 'docs',
              docsUrl: '/docs/reference/crux-core/catalog-lints/tool-missing-input-schema',
            }),
            expect.objectContaining({
              kind: 'suppress',
              suppression: '// crux-lint-disable-next-line tool.missing_input_schema -- reason',
            }),
          ]),
          docsUrl: '/docs/reference/crux-core/catalog-lints/tool-missing-input-schema',
          propagatedDefinitionIds: expect.arrayContaining(['agent:writer-agent', 'agent:Karyla']),
          propagationPaths: expect.arrayContaining([
            expect.objectContaining({
              fromDefinitionId: 'agent:writer-agent',
              toDefinitionId: 'tool:searchDocs',
              relationTypes: ['agent.uses_tool'],
            }),
          ]),
          suppression: expect.objectContaining({
            supported: true,
            directive: '// crux-lint-disable-next-line tool.missing_input_schema -- reason',
            scope: 'next-line',
          }),
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
    expect(snapshot.lintFindings).not.toEqual(expect.arrayContaining([expect.objectContaining({ maturity: 'advisory' })]))
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
          code: 'catalog.lint_unknown_configured_rule',
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
        expect.objectContaining({ ruleId: 'prompt.missing_input_schema', relatedDefinitionIds: ['prompt:no-output-prompt'] }),
        expect.objectContaining({ ruleId: 'context.missing_input_schema', relatedDefinitionIds: ['context:static-context'] }),
      ]),
    )
  })

  it('emits a handoff observability lint when an agent target is not catalog-visible', async () => {
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
              label: 'Handoff target is not catalog-visible',
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
        schema: expect.objectContaining({ properties: expect.objectContaining({ userIntent: expect.objectContaining({ type: 'string' }) }) }),
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
        blocks: [expect.objectContaining({ id: 'episodes', kind: 'episodes', schema: expect.objectContaining({ name: 'EpisodicEntry' }) })],
      }),
    )
    expect(byId.get('memory:project-knowledge')?.metadata).toEqual(
      expect.objectContaining({
        runtimeIdPrefix: 'project-knowledge:',
        backend: 'cruxConvexStore',
        schema: expect.objectContaining({ name: 'SemanticFact', type: 'object' }),
        blocks: [expect.objectContaining({ id: 'facts', kind: 'facts', schema: expect.objectContaining({ name: 'SemanticFact' }) })],
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

  it('honors catalog lint suppression comments and reports stale suppressions', async () => {
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
      expect.arrayContaining([expect.objectContaining({ ruleId: 'tool.missing_input_schema', relatedDefinitionIds: ['tool:ignoredTool'] })]),
    )
    expect(snapshot.lintFindings).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: 'tool.missing_input_schema', relatedDefinitionIds: ['tool:noisyTool'] })]),
    )
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'catalog.lint_unused_suppression' }),
        expect.objectContaining({ code: 'catalog.lint_unknown_suppression_rule' }),
      ]),
    )
  })

  it('does not treat conventional unit test files as authored catalog definitions', async () => {
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
        expect.objectContaining({ type: 'flow.includes_step', from: 'flow:writer-flow', to: 'flow.step:writer-flow:draft' }),
        expect.objectContaining({ type: 'flow.includes_step', from: 'flow:writer-flow', to: 'flow.step:writer-flow:review' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.parallel:writerParallel', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.pipeline:writerPipeline', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.consensus:writerConsensus', to: 'agent:writer-agent' }),
        expect.objectContaining({ type: 'composition.uses_agent', from: 'composition.swarm:writerSwarm', to: 'agent:writer-agent' }),
      ]),
    )
  })

  it('upgrades import-safe rich primitive exports to resolved catalog definitions', async () => {
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
        export const writerPrompt = prompt({ id: 'writer', use: [brand], prompt: 'Write' })
        export const writerAgent = agent({
          id: 'writer-agent',
          description: 'Writes drafts',
          prompt: writerPrompt,
          handoffs: [{ id: 'reviewer-agent', when: 'Needs review' }],
        })
        export const writerFlow = flow('writer-flow', async (flow) => flow.step('draft', async () => 'done'))
        export const docsRetriever = retriever({ id: 'docs', namespace: 'kb', retrieve: async () => [] })
        export const queryStage = retrievalStage({ name: 'rewrite', phase: 'query', run: ({ query }) => ({ query }) })
        export const docsRag = retrievalPipeline(docsRetriever, [queryStage])
        export const sessionMemory = memory({ id: 'session-memory', blocks: [] })
        export const notes = blackboard({ id: 'notes', schema: z.object({ summary: z.string().optional() }) })
        export const safeTone = constraint({ name: 'safe-tone', severity: 'assert', check: () => ({ pass: true }) })
        export const outputGuard = guardrail({ name: 'output-guard', phase: 'output', validate: () => ({ action: 'pass' }) })
        export const factuality = llmJudge({ id: 'factuality', criteria: 'Be factual', scale: { min: 0, max: 1 } })
      `,
    )

    const snapshot = await indexProject({ root })
    const byId = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))

    expect(byId.get('agent:writer-agent')).toMatchObject({
      kind: 'agent',
      fidelity: 'resolved',
      source: expect.objectContaining({ line: expect.any(Number) }),
      metadata: expect.objectContaining({ promptId: 'writer', handoffs: [{ id: 'reviewer-agent', when: 'Needs review' }] }),
    })
    expect(byId.get('flow:writer-flow')).toMatchObject({ kind: 'flow', fidelity: 'resolved' })
    expect(byId.get('rag.retriever:docs')).toMatchObject({ kind: 'rag.retriever', fidelity: 'resolved', metadata: expect.objectContaining({ namespace: 'kb' }) })
    expect(byId.get('rag.pipeline:docsRag')).toMatchObject({ kind: 'rag.pipeline', fidelity: 'resolved', metadata: expect.objectContaining({ retrieverId: 'docs', stageNames: ['rewrite'] }) })
    expect(byId.get('memory:session-memory')).toMatchObject({ kind: 'memory', fidelity: 'resolved' })
    expect(byId.get('blackboard:notes')).toMatchObject({ kind: 'blackboard', fidelity: 'resolved' })
    expect(byId.get('constraint:safe-tone')).toMatchObject({ kind: 'constraint', fidelity: 'resolved', metadata: expect.objectContaining({ severity: 'assert' }) })
    expect(byId.get('guardrail:output-guard')).toMatchObject({ kind: 'guardrail', fidelity: 'resolved', metadata: expect.objectContaining({ phase: 'output' }) })
    expect(byId.get('scorer:factuality')).toMatchObject({ kind: 'scorer', fidelity: 'resolved' })
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:writer-agent', to: 'prompt:writer', fidelity: 'resolved' }),
        expect.objectContaining({ type: 'agent.can_handoff_to', from: 'agent:writer-agent', to: 'agent:reviewer-agent', fidelity: 'resolved' }),
        expect.objectContaining({ type: 'rag.pipeline.uses_retriever', from: 'rag.pipeline:docsRag', to: 'rag.retriever:docs', fidelity: 'resolved' }),
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
    const previousCatalog = await indexProject({ root, staticOnly: true })

    const decision = planIndexFiles({
      root,
      previousCatalog,
      files: ['src/b.ts', 'src/a.ts', 'src/a.ts'],
    })

    expect(decision).toEqual({
      kind: 'full-reindex-required',
      reason: 'dependency-graph-not-materialized',
      root,
      files: [join(root, 'src/a.ts'), join(root, 'src/b.ts')],
      previousCatalogDefinitionCount: previousCatalog.definitions.length,
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

    const parsed = await parseStaticDefinitions(root, indexFile, staticFileParser)

    expect(parsed.dependencies).toEqual([dependencyFile])
    expect(parsed.definitions.some((definition) => definition.id === 'prompt:writer' && definition.path?.join('/') === 'writer')).toBe(true)
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

    const parsed = await parseStaticDefinitions(root, indexFile, staticFileParser)

    expect(parsed.dependencies).toEqual([dependencyFile])
    expect(parsed.definitions.some((definition) => definition.id === 'prompt:writer' && definition.path?.join('/') === 'agent/writer')).toBe(true)
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

    const first = await parseStaticDefinitionsCached(root, indexFile, staticFileParser)
    await writeFile(
      dependencyFile,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer-v2', prompt: 'Write' })
      `,
    )
    const second = await parseStaticDefinitionsCached(root, indexFile, staticFileParser)

    expect(first.definitions.some((definition) => definition.id === 'prompt:writer-v1')).toBe(true)
    expect(second.definitions.some((definition) => definition.id === 'prompt:writer-v2')).toBe(true)
    expect(second.definitions.some((definition) => definition.id === 'prompt:writer-v1')).toBe(false)
  })
})
