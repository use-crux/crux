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
        'export default {',
        '  config: {',
        "    indexer: { trust: { mode: 'first-party-only' } },",
        '    observability: {',
        "      redactPatterns: [{ pattern: /ACME-\\\\d+/gi, replacement: '[hidden]' }],",
        '    },',
        '  },',
        '  prompts: [],',
        '  contexts: [],',
        '  get() {},',
        '}',
      ].join('\n'),
    )

    const result = await inspectProjectStaticIndexConfig({ root })
    expect(result).toMatchObject({
      root,
      extensions: [],
      redactPatternsConfigured: true,
      diagnostics: [],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/ACME|hidden|replacement|flags|redactPatterns":|ruleCount|patternCount/)
    expect(result).not.toHaveProperty('nativeAstEnabled')
    expect(result).not.toHaveProperty('staticSyntaxEnabled')
  }, 30_000)

  it('distinguishes known-empty config from config-load failure', async () => {
    const emptyRoot = await fixtureRoot()
    await writeFile(
      join(emptyRoot, 'crux.config.ts'),
      ['export default {', '  config: {},', '  prompts: [],', '  contexts: [],', '  get() {},', '}'].join('\n'),
    )
    const failedRoot = await fixtureRoot()
    await writeFile(join(failedRoot, 'crux.config.ts'), "throw new Error('config failed')")

    const knownEmpty = await inspectProjectStaticIndexConfig({
      root: emptyRoot,
    })
    const unknown = await inspectProjectStaticIndexConfig({ root: failedRoot })

    expect(knownEmpty.redactPatternsConfigured).toBe(false)
    expect(unknown).not.toHaveProperty('redactPatternsConfigured')
  }, 30_000)

  it('disables cache reuse when an explicit extends dependency is outside root', async () => {
    const parent = await fixtureRoot()
    const root = join(parent, 'project')
    await mkdir(root, { recursive: true })
    await writeFile(join(parent, 'base.json'), '{"compilerOptions":{"module":"ESNext"}}\n')
    await writeFile(join(root, 'tsconfig.json'), '{"extends":"../base.json"}\n')
    await writeFile(
      join(root, 'crux.config.ts'),
      'export default { config: {}, prompts: [], contexts: [], get() {} }\n',
    )

    const result = await inspectProjectStaticIndexConfig({ root })

    expect(result.configDependencies).toEqual(['tsconfig.json'])
    expect(result.cacheDisabled).toBe(true)
  }, 30_000)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-index-config-wire-'))
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
