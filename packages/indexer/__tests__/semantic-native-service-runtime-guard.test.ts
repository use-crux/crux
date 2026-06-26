import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeSemanticBackend } from '../indexer/semantic/backends/tsgo/backend'
import { createSemanticIndexService } from '../indexer/semantic/service/service'

const jsTypeScriptParserCalls = vi.hoisted((): string[] => [])

vi.mock('../indexer/ast/parse', () => ({
  createSourceFile(file: string): never {
    jsTypeScriptParserCalls.push(file)
    throw new Error(`Native semantic indexing must not create a JS TypeScript SourceFile for ${file}`)
  },
  async readSourceFile(file: string): Promise<never> {
    jsTypeScriptParserCalls.push(file)
    throw new Error(`Native semantic indexing must not read a JS TypeScript SourceFile for ${file}`)
  },
}))

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-native-runtime-guard-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  jsTypeScriptParserCalls.length = 0
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('native semantic runtime guardrails', () => {
  it('indexes through native AST traversal without instantiating JS TypeScript source files', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const helperFile = join(root, 'src/helper.ts')
    const file = join(root, 'src/writer.ts')
    await writeFile(helperFile, `export const system = 'Write directly.'`)
    await writeFile(
      file,
      `
        import { prompt } from '@use-crux/core'
        import { system } from './helper'

        export const writer = prompt({
          id: 'native-runtime-guard',
          system,
        })
      `,
    )

    const syntaxTraversals: string[] = []
    const patch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({
      root,
      files: [file],
      semanticInstrumentation: {
        onNativeCoverage: (coverage) => {
          syntaxTraversals.push('syntaxTraversal' in coverage ? coverage.syntaxTraversal : 'unknown')
        },
      },
    })

    expect(patch.status).toBe('ok')
    expect(jsTypeScriptParserCalls).toEqual([])
    expect(syntaxTraversals).toEqual(['native-ast'])
  }, 20_000)
})

async function writeTsconfig(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  )
}
