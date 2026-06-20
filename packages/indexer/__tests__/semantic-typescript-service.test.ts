import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSemanticIndexService, createTypeScriptSemanticBackend } from '../indexer/semantic/service'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-typescript-service-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('typescript semantic index service', () => {
  it('reuses TypeScript project state inside the semantic backend for the same source identity', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = 'writer'`)

    const timingNames: string[] = []
    const service = createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    })

    for (let index = 0; index < 2; index += 1) {
      const patch = await service.indexFiles({
        root,
        files: [file],
        semanticInstrumentation: {
          onTiming: (timing) => timingNames.push(timing.name),
        },
      })
      expect(patch.status).toBe('ok')
    }

    expect(
      timingNames.filter((name) => name === 'semantic.program.create' || name === 'semantic.program.reuse'),
    ).toEqual(['semantic.program.create', 'semantic.program.reuse'])
  })

  it('reuses TypeScript oldProgram when the semantic source identity changes', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = 'first'`)

    const timingNames: string[] = []
    const service = createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    })
    const instrumentation = {
      onTiming: (timing: { readonly name: string }) => timingNames.push(timing.name),
    }

    await service.indexFiles({ root, files: [file], semanticInstrumentation: instrumentation })
    await writeFile(file, `export const writer = 'second'`)
    await service.indexFiles({ root, files: [file], semanticInstrumentation: instrumentation })

    expect(
      timingNames.filter((name) => name === 'semantic.program.create' || name === 'semantic.program.reuse'),
    ).toEqual(['semantic.program.create', 'semantic.program.reuse'])
  })
})
