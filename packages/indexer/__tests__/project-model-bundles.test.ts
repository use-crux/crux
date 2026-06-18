import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectModel } from '../index'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-project-model-bundles-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Project Model prompt and context bundles', () => {
  it('exposes no-config exported prompt and context bundle paths with source provenance', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/source-bundles' }))
    await writeFile(
      join(root, 'src/contexts.ts'),
      `
        import { context } from '@crux/core'

        export const brand = context({ id: 'brand', system: 'Use the brand voice.' })
        export const locale = context({ id: 'locale', system: 'Use the requested locale.' })
      `,
    )
    await writeFile(
      join(root, 'src/prompts.ts'),
      `
        import { prompt } from '@crux/core'
        import { brand } from './contexts'

        export const answer = prompt({
          id: 'answer',
          use: [brand],
          prompt: 'Answer the customer.',
        })

        export const summarize = prompt({
          id: 'summarize',
          prompt: 'Summarize the conversation.',
        })
      `,
    )
    await writeFile(
      join(root, 'src/index.ts'),
      `
        import { createContexts, createPrompts } from '@crux/core'
        import { brand, locale } from './contexts'
        import { answer, summarize } from './prompts'

        export const prompts = createPrompts({
          support: { answer },
          internal: { summarize },
        })

        export const contexts = createContexts({
          support: { brand },
          locale,
        })
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })
    const byId: ReadonlyMap<string, (typeof model.definitions)[number]> = new Map(
      model.definitions.map((definition) => [definition.id, definition]),
    )

    expect(model.configFiles).toContainEqual(
      expect.objectContaining({ status: expect.objectContaining({ value: 'missing' }) }),
    )
    expect(byId.get('prompt:answer')).toMatchObject({
      kind: 'prompt',
      path: {
        value: ['support', 'answer'],
        provenance: { kind: 'source', file: join(root, 'src/prompts.ts'), exportName: 'answer' },
      },
    })
    expect(byId.get('prompt:summarize')).toMatchObject({
      kind: 'prompt',
      path: {
        value: ['internal', 'summarize'],
        provenance: { kind: 'source', file: join(root, 'src/prompts.ts'), exportName: 'summarize' },
      },
    })
    expect(byId.get('context:brand')).toMatchObject({
      kind: 'context',
      path: {
        value: ['support', 'brand'],
        provenance: { kind: 'source', file: join(root, 'src/contexts.ts'), exportName: 'brand' },
      },
    })
    expect(byId.get('context:locale')).toMatchObject({
      kind: 'context',
      path: {
        value: ['locale'],
        provenance: { kind: 'source', file: join(root, 'src/contexts.ts'), exportName: 'locale' },
      },
    })
  })

  it('exposes prompt-to-context use bindings as inferred Project Model relations', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/source-relations' }))
    await writeFile(
      join(root, 'src/contexts.ts'),
      `
        import { context } from '@crux/core'

        export const brand = context({ id: 'brand', system: 'Use the brand voice.' })
        export const locale = context({ id: 'locale', system: 'Use the requested locale.' })
      `,
    )
    await writeFile(
      join(root, 'src/prompts.ts'),
      `
        import { prompt } from '@crux/core'
        import { brand, locale } from './contexts'

        const supportContexts = [brand, locale]

        export const answer = prompt({
          id: 'answer',
          use: supportContexts,
          prompt: 'Answer the customer.',
        })
      `,
    )
    await writeFile(
      join(root, 'src/index.ts'),
      `
        import { createContexts, createPrompts } from '@crux/core'
        import { brand, locale } from './contexts'
        import { answer } from './prompts'

        export const prompts = createPrompts({
          support: { answer },
        })

        export const contexts = createContexts({
          support: { brand, locale },
        })
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })

    expect(model.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'prompt.uses_context',
          from: 'prompt:answer',
          to: 'context:brand',
          source: expect.objectContaining({ file: join(root, 'src/prompts.ts') }),
          visibility: {
            value: 'inferred',
            provenance: { kind: 'source', file: join(root, 'src/prompts.ts'), exportName: 'answer' },
          },
        }),
        expect.objectContaining({
          type: 'prompt.uses_context',
          from: 'prompt:answer',
          to: 'context:locale',
          visibility: {
            value: 'inferred',
            provenance: { kind: 'source', file: join(root, 'src/prompts.ts'), exportName: 'answer' },
          },
        }),
      ]),
    )
  })

  it('diagnoses tested prompts with unprovable source dependencies', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/prompt-test-diagnostics' }))
    await writeFile(
      join(root, 'src/prompts.ts'),
      `
        import { createPrompts, prompt } from '@crux/core'

        export const answer = prompt({
          id: 'answer',
          use: [missingContext],
          prompt: 'Answer the customer.',
          tests: [{ input: { question: 'How do refunds work?' } }],
        })

        export const prompts = createPrompts({
          support: { answer },
        })
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'source-only' })
    const diagnostic = model.diagnostics.find((entry) => entry.code === 'project_model.prompt_test_dependency_unproven')

    expect(diagnostic).toMatchObject({
      code: 'project_model.prompt_test_dependency_unproven',
      severity: 'warning',
      source: expect.objectContaining({ file: join(root, 'src/prompts.ts') }),
      provenance: { kind: 'source', file: join(root, 'src/prompts.ts') },
      details: expect.objectContaining({
        missingDefinitionId: 'context:missing-context',
        primaryDefinitionId: 'prompt:answer',
        relationType: 'prompt.uses_context',
      }),
    })
    expect(diagnostic?.message).toContain('colocated prompt tests')
    expect(diagnostic?.suggestedFix).toContain('stable exported context')
  })
})
