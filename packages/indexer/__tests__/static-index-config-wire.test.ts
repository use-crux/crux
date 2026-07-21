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
  it('emits only executable config policy needed by the Go planner', async () => {
    const root = await fixtureRoot()
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        "import { config } from '@use-crux/core'",
        '',
        'export default config({',
        "  indexer: { trust: { mode: 'first-party-only' } },",
        '})',
      ].join('\n'),
    )

    const result = await inspectProjectStaticIndexConfig({ root })
    expect(result).toMatchObject({ root, extensions: [], diagnostics: [] })
    expect(result).not.toHaveProperty('nativeAstEnabled')
    expect(result).not.toHaveProperty('staticSyntaxEnabled')
  }, 30_000)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-index-config-wire-'))
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
