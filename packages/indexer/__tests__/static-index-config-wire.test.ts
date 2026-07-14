import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectProjectStaticIndexConfig } from '../src/host/static-index'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Static Index config wire artifact', () => {
  it('emits both static syntax and nativeAst config keys for Go compatibility', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        "import { config } from '@use-crux/core'",
        '',
        'export default config({',
        "  experimental: { indexer: { nativeAst: { frontend: 'oxc' } } },",
        '})',
      ].join('\n'),
    )

    await expect(inspectProjectStaticIndexConfig({ root })).resolves.toMatchObject({
      nativeAstEnabled: true,
      nativeAstConfigured: true,
      nativeAstFrontend: 'oxc',
      staticSyntaxEnabled: true,
      staticSyntaxConfigured: true,
      staticSyntaxFrontend: 'oxc',
    })
  }, 30_000)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-index-config-wire-'))
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
