import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  astCatalogPatchFromCompilerResult,
  compileProjectCatalog,
  projectCatalogSnapshotFromCompilerResult,
} from '../indexer/compiler'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-project-catalog-compiler-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project catalog compiler', () => {
  it('compiles source-only catalogs as immutable results without importing user config modules', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
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

        throw new Error('source-only compiler must not import config modules')

        export default config({})
      `,
    )

    const result = await compileProjectCatalog({ root, projectName: 'fixture', mode: 'source-only' })
    const snapshot = projectCatalogSnapshotFromCompilerResult(result)
    const patch = astCatalogPatchFromCompilerResult(result)

    expect(result.project).toEqual({
      root,
      name: 'fixture',
      configFile: join(root, 'crux.config.ts'),
    })
    expect(result.facts.definitions).toContainEqual(
      expect.objectContaining({ id: 'prompt:writer', kind: 'prompt', fidelity: 'resolved' }),
    )
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'catalog.static_only' }))
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'catalog.config_import_failed' }))
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        file: join(root, 'crux.config.ts'),
        status: 'partial',
        diagnostics: expect.arrayContaining([expect.stringContaining('catalog:static-only')]),
      }),
    )
    expect(snapshot.definitions.map((definition) => definition.id)).toContain('prompt:writer')
    expect(snapshot.sources).toEqual(result.sources)
    expect(patch.phase).toBe('ast')
    expect(patch.invalidates).toEqual({ all: true })
    expect(patch.facts.definitions).toEqual(result.facts.definitions)
    expect(patch.facts.sources).toEqual(result.sources)
  })

  it('emits AST patches with caller-provided exact invalidation', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
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

    const result = await compileProjectCatalog({
      root,
      projectName: 'fixture',
      mode: 'source-only',
      indexedAt: '2026-01-01T00:00:00.000Z',
    })
    const patch = astCatalogPatchFromCompilerResult(result, {
      invalidates: { files: [join(root, 'src/writer.ts')], definitionIds: ['prompt:writer'] },
      status: 'partial',
      finishedAt: '2026-01-01T00:00:01.000Z',
    })

    expect(patch.startedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(patch.finishedAt).toBe('2026-01-01T00:00:01.000Z')
    expect(patch.status).toBe('partial')
    expect(patch.invalidates).toEqual({ files: [join(root, 'src/writer.ts')], definitionIds: ['prompt:writer'] })
    expect(patch.facts.definitions?.map((definition) => definition.id)).toContain('prompt:writer')
  })
})
