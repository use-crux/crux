import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
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

  it('matches TypeScript facts for an input media guardrail through the native shared analyzer', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/safety.ts')
    await writeFile(
      file,
      `
        import { boundary, guardrail } from '@use-crux/core/safety'

        const inspectUpload = () => ({ action: 'allow' as const })

        export const mediaUpload = guardrail({
          id: 'media-upload',
          on: boundary.input.media(),
          run: inspectUpload,
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

  it('routes authored media through one complete shared analysis without partial direct facts', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    await linkWorkspacePackages(root, ['ai', 'core'])
    const file = join(root, 'src/media.ts')
    await writeFile(
      file,
      `
        import { generate, generateImage as image } from '@use-crux/ai'
        import { prompt, router } from '@use-crux/core'
        import type { ImageModel, LanguageModel } from 'ai'

        declare const imageModel: ImageModel
        declare const languageModel: LanguageModel
        const render = image
        const visionPrompt = prompt({ id: 'vision-prompt' })
        const route = router({
          id: 'vision-route',
          classify: () => 'vision' as const,
          routes: { vision: languageModel, default: languageModel },
        })
        const options = {
          model: imageModel, n: 2,
        }
        export const cover = render(options)
        export const unsafe = generate(visionPrompt, { model: route, messages: [{
          role: 'user', content: [{ type: 'image', source: {
            type: 'asset-ref', ref: { uri: 'private-ref' }
          } }],
        }] })
      `,
    )

    const result = await compareNativeToTypeScript(root, [file])

    expect(result.timingNames).toContain('semantic.native.analyzer.shared')
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

async function linkWorkspacePackages(
  root: string,
  packages: readonly string[],
): Promise<void> {
  const scope = join(root, 'node_modules/@use-crux')
  await mkdir(scope, { recursive: true })
  await Promise.all(
    packages.map((name) =>
      symlink(join(process.cwd(), `../${name}`), join(scope, name), 'dir'),
    ),
  )
  if (packages.includes('ai')) {
    await symlink(
      join(process.cwd(), '../ai/node_modules/ai'),
      join(root, 'node_modules/ai'),
      'dir',
    )
  }
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
