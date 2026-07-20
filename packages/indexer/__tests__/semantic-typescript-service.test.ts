import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { createSemanticIndexService, createTypeScriptSemanticBackend } from '../src/indexer/semantic/service'
import { semanticSourceProfileFileFromSource } from '../src/indexer/semantic/source-profile'

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
  it('disables durable semantic cache reads and writes per request', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = 'writer'`)
    const timingNames: string[] = []

    const patch = await createSemanticIndexService().indexFiles({
      root,
      files: [file],
      semanticCache: 'disabled',
      semanticInstrumentation: {
        onTiming: (timing) => timingNames.push(timing.name),
      },
    })

    expect(patch.status).toBe('ok')
    expect(timingNames).toContain('semantic.cache.disabled')
    await expect(access(join(root, '.crux/cache/index'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports the JavaScript TypeScript package as its compiler runtime identity', async () => {
    const root = await fixtureRoot()
    const backend = createTypeScriptSemanticBackend()

    expect(backend.compilerRuntimeIdentity).toBeTypeOf('function')
    await expect(
      Promise.resolve(backend.compilerRuntimeIdentity?.({ root, backend: backend.identity })),
    ).resolves.toEqual({
      name: 'typescript',
      version: ts.version,
    })
  })

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

  it('uses preflight source text without rereading the local closure from disk', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const helper = join(root, 'src/helper.ts')
    const helperSource = `export const profiledSystem = 'Use the source profile.'`
    const profiledSource = `import { prompt } from '@use-crux/core'\nimport { profiledSystem } from './helper'\nexport const writer = prompt({ id: 'profiled-writer', system: profiledSystem })`
    const profile = semanticSourceProfileFileFromSource(file, profiledSource, { includeSource: true })
    const helperProfile = semanticSourceProfileFileFromSource(helper, helperSource, { includeSource: true })

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({
      root,
      files: [file],
      sourceProfile: {
        files: [helperProfile, profile],
        dependencyClosure: [helper, file].sort(),
        sourceBytes: profile.sourceBytes + helperProfile.sourceBytes,
        complete: true,
      },
    })

    expect(patch.status).toBe('ok')
    expect(patch.facts?.sourceRefs).toContainEqual(
      expect.objectContaining({
        definitionId: 'prompt:profiled-writer',
        ref: expect.objectContaining({
          property: 'system',
          symbol: 'profiledSystem',
          source: expect.objectContaining({ file: helper }),
        }),
      }),
    )
  })
})
