import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject, inspectProjectConfig, resolveProjectModel } from '..'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-project-config-policy-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('config-policy Project Model resolution', () => {
  it('loads config policy without importing discovered source modules', async () => {
    const root = await fixtureRoot()
    const marker = '__cruxConfigPolicySourceImported'
    delete (globalThis as unknown as Record<string, unknown>)[marker]

    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        export default config({
          lint: { profile: 'strict' },
          quality: { id: 'policy-quality' },
          experimental: { indexer: { nativeAst: true } },
        })
      `,
    )
    await writeFile(
      join(root, 'src/answer.ts'),
      `
        import { prompt } from '@crux/core'

        ;(globalThis as unknown as Record<string, unknown>).${marker} = true

        export const answer = prompt({
          id: 'answer',
          prompt: 'Answer safely.',
        })
      `,
    )

    const model = await resolveProjectModel({ root, resolutionMode: 'config-policy' })
    const config = await inspectProjectConfig({ root })
    const snapshot = await indexProject({ root, resolutionMode: 'config-policy' })

    expect(model.resolutionMode.value).toBe('config-policy')
    expect(model.configFiles[0]?.status.value).toBe('loaded')
    expect(model.definitions.map((definition) => definition.id)).toContain('prompt:answer')
    expect(config.configFile.status).toBe('loaded')
    expect(config.quality.id).toEqual({ value: 'policy-quality', origin: 'config' })
    expect(config.experimental.indexer.nativeAst).toEqual({ value: 'oxc', origin: 'config' })
    expect(config.experimental.indexer.native).toEqual({ value: 'false', origin: 'default' })
    expect(snapshot.lint?.profile).toBe('strict')
    expect(snapshot.definitions.map((definition) => definition.id)).toContain('prompt:answer')
    expect((globalThis as unknown as Record<string, unknown>)[marker]).toBeUndefined()
  })

  it('falls back to source-only facts when config policy import fails', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        throw new Error('policy import failed')
      `,
    )
    await writeFile(
      join(root, 'src/answer.ts'),
      `
        import { prompt } from '@crux/core'

        export const answer = prompt({
          id: 'answer',
          prompt: 'Answer safely.',
        })
      `,
    )

    const config = await inspectProjectConfig({ root })

    expect(config.configFile.status).toBe('import-failed')
    expect(config.discovered.definitions).toBe(1)
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'index.config_import_failed',
          message: expect.stringContaining('policy import failed'),
        }),
      ]),
    )
  })
})
