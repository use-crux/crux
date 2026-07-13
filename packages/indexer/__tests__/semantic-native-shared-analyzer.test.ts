import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexPatchFacts } from '../src/indexer/patches'
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../src/indexer/semantic/service'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(process.cwd(), '.tmp-semantic-native-shared-analyzer-'),
  )
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('native semantic shared analyzer', () => {
  it('matches TypeScript facts through the tsgo-owned shared analyzer path', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const helperFile = join(root, 'src/helper.ts')
    const file = join(root, 'src/writer.ts')
    await writeFile(helperFile, `export const writerSystem = 'Write clearly.'`)
    await writeFile(
      file,
      `
        import { prompt } from '@use-crux/core'
        import { writerSystem } from './helper'

        export const writer = prompt({
          id: 'writer',
          system: writerSystem,
        })
      `,
    )

    const result = await compareNativeToTypeScript(root, [file, helperFile])

    expect(result.timingNames).toContain('semantic.native.analyzer.shared')
    expect(result.timingNames).not.toContain('semantic.native.fallback.api')
    expect(result.coverageKinds).toEqual(['complete-native'])
    expect(result.syntaxTraversals).toEqual(['native-ast'])
    expect(result.extractorNames).toEqual([['crux.shared-analyzer']])
  }, 20_000)

  it('uses the native shared analyzer when a file contains a manifest-known primitive outside the direct projector', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/safety.ts')
    await writeFile(
      file,
      `
        import { guardrail, prompt } from '@use-crux/core'

        export const writerPrompt = prompt({ id: 'writer-direct' })
        export const outputGuard = guardrail({
          name: 'output-guard',
          phase: 'output',
          validate: () => ({ action: 'pass' }),
        })
      `,
    )

    const result = await compareNativeToTypeScript(root, [file])

    expect(result.timingNames).toContain('semantic.native.analyzer.shared')
    expect(result.timingNames).not.toContain('semantic.native.fallback.api')
    expect(result.coverageKinds).toEqual(['complete-native'])
    expect(result.syntaxTraversals).toEqual(['native-ast'])
    expect(result.extractorNames).toEqual([['crux.shared-analyzer']])
  }, 20_000)

  it('uses the native shared analyzer when a direct-native file contains an unknown extension-style top-level call', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const extensionFile = join(root, 'src/extension.ts')
    const file = join(root, 'src/writer.ts')
    await writeFile(
      extensionFile,
      `
        export function customPrimitive(config: { readonly id: string }) {
          return config
        }
      `,
    )
    await writeFile(
      file,
      `
        import { prompt } from '@use-crux/core'
        import { customPrimitive } from './extension'

        export const writerPrompt = prompt({ id: 'writer-direct' })
        export const customThing = customPrimitive({ id: 'third-party' })
      `,
    )

    const result = await compareNativeToTypeScript(root, [file, extensionFile])

    expect(result.timingNames).toContain('semantic.native.analyzer.shared')
    expect(result.timingNames).not.toContain('semantic.native.fallback.api')
    expect(result.coverageKinds).toEqual(['complete-native'])
    expect(result.syntaxTraversals).toEqual(['native-ast'])
    expect(result.extractorNames).toEqual([['crux.shared-analyzer']])
  }, 20_000)
})

async function compareNativeToTypeScript(
  root: string,
  files: readonly string[],
): Promise<{
  readonly timingNames: readonly string[]
  readonly coverageKinds: readonly string[]
  readonly syntaxTraversals: readonly ('native-ast' | undefined)[]
  readonly extractorNames: readonly (readonly string[])[]
}> {
  const timingNames: string[] = []
  const coverageKinds: string[] = []
  const syntaxTraversals: ('native-ast' | undefined)[] = []
  const extractorNames: (readonly string[])[] = []
  const typescriptPatch = await createSemanticIndexService({
    backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
  }).indexFiles({ root, files })
  const nativePatch = await createSemanticIndexService({
    backend: createNativeSemanticBackend({ cache: 'disabled' }),
  }).indexFiles({
    root,
    files,
    semanticInstrumentation: {
      onTiming: (timing) => timingNames.push(timing.name),
      onNativeCoverage: (coverage) => {
        coverageKinds.push(coverage.kind)
        syntaxTraversals.push(
          'syntaxTraversal' in coverage ? coverage.syntaxTraversal : undefined,
        )
        if ('extractors' in coverage) extractorNames.push(coverage.extractors)
      },
    },
  })

  expect(typescriptPatch.status).toBe('ok')
  expect(nativePatch.status).toBe('ok')
  expect(normalizedFacts(nativePatch.facts)).toEqual(
    normalizedFacts(typescriptPatch.facts),
  )
  return { timingNames, coverageKinds, syntaxTraversals, extractorNames }
}

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

function normalizedFacts(facts: IndexPatchFacts): IndexPatchFacts {
  return {
    definitions: sortJsonRows(facts.definitions),
    sourceRefs: sortJsonRows(facts.sourceRefs),
    relations: sortJsonRows(facts.relations),
    diagnostics: sortJsonRows(facts.diagnostics),
    lintFindings: sortJsonRows(facts.lintFindings),
    sources: sortJsonRows(facts.sources),
    sourceGraph: facts.sourceGraph,
  }
}

function sortJsonRows<T>(rows: readonly T[] | undefined): T[] | undefined {
  return rows
    ? [...rows].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      )
    : undefined
}
