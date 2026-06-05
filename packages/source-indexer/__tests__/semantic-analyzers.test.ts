import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { semanticSchemaCatalogFacts } from '../indexer/semantic'

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

    const facts = semanticSchemaCatalogFacts(root, [
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
  })
})
