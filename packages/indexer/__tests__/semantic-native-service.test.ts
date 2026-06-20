import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProjectSemantic } from '../index'
import type { IndexPatchFacts } from '../indexer/patches'
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../indexer/semantic/service'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-native-service-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('native semantic index service', () => {
  it('reuses the experimental native engine host for the same semantic project identity', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/writer.ts')
    await writeFile(
      file,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer' })
      `,
    )

    const timingNames: string[] = []
    const service = createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    })
    const semanticInstrumentation = {
      onTiming: (timing: { readonly name: string }) => timingNames.push(timing.name),
    }

    for (let index = 0; index < 2; index += 1) {
      const patch = await service.indexFiles({ root, files: [file], semanticInstrumentation })
      expect(patch.status).toBe('ok')
    }

    expect(
      timingNames.filter((name) => name === 'semantic.native.host.create' || name === 'semantic.native.host.reuse'),
    ).toEqual(['semantic.native.host.create', 'semantic.native.host.reuse'])
  }, 20_000)

  it('does not start the experimental native engine host for semantic cache hits', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/cached.ts')
    await writeFile(
      file,
      `
        import { prompt } from '@crux/core'
        export const cached = prompt({ id: 'cached' })
      `,
    )

    const service = createSemanticIndexService({
      backend: createNativeSemanticBackend(),
    })
    const collectTimingNames = () => {
      const timingNames: string[] = []
      return {
        timingNames,
        semanticInstrumentation: {
          onTiming: (timing: { readonly name: string }) => timingNames.push(timing.name),
        },
      }
    }

    const firstRun = collectTimingNames()
    const firstPatch = await service.indexFiles({
      root,
      files: [file],
      semanticInstrumentation: firstRun.semanticInstrumentation,
    })
    expect(firstPatch.status).toBe('ok')
    expect(firstRun.timingNames).toContain('semantic.native.host.create')

    const secondRun = collectTimingNames()
    const secondPatch = await service.indexFiles({
      root,
      files: [file],
      semanticInstrumentation: secondRun.semanticInstrumentation,
    })
    expect(secondPatch.status).toBe('ok')
    expect(secondRun.timingNames).not.toContain('semantic.native.host.create')
    expect(secondRun.timingNames).not.toContain('semantic.native.host.reuse')
  }, 20_000)

  it('matches TypeScript facts while using the native direct Crux path with zod schemas', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/feature-0.ts')
    await writeFile(
      file,
      `
        import { context, prompt, tool } from '@crux/core'
        import { z } from 'zod'

        const Input0 = z.object({
          accountId: z.string(),
          priority: z.enum(['low', 'medium', 'high']),
          tags: z.array(z.object({ key: z.string(), value: z.string().optional() })),
        })
        const Output0 = z.object({ answer: z.string(), actions: z.array(z.string()) })
        export const customerContext0 = context({ id: 'customer-0', schema: Input0, load: async () => ({ accountId: '0', priority: 'low', tags: [] }) })
        export const lookupTool0 = tool({ name: 'lookup-0', parameters: Input0, output: Output0, run: async () => ({ answer: 'ok', actions: [] }) })
        export const supportPrompt0 = prompt({ id: 'support-0', input: Input0, output: Output0, use: [customerContext0], tools: { lookupTool0 }, prompt: 'Help customer 0' })
      `,
    )

    const timingNames: string[] = []
    const coverageKinds: string[] = []
    const typescriptPatch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file] })
    const nativePatch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({
      root,
      files: [file],
      semanticInstrumentation: {
        onTiming: (timing) => timingNames.push(timing.name),
        onNativeCoverage: (coverage) => coverageKinds.push(coverage.kind),
      },
    })

    expect(typescriptPatch.status).toBe('ok')
    expect(nativePatch.status).toBe('ok')
    expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
    expect(timingNames).toContain('semantic.native.extractor.direct_crux')
    expect(timingNames).not.toContain('semantic.analyzer.execution')
    expect(coverageKinds).toEqual(['complete-native'])
  }, 20_000)

  it('matches TypeScript facts while using the native direct Crux path without zod', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/simple.ts')
    await writeFile(
      file,
      `
        import { context, prompt, tool } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const searchTool = tool({ name: 'search', execute: async () => ({}) })
        export const writerPrompt = prompt({
          id: 'writer-simple',
          use: [brandContext],
          tools: { searchTool },
        })
      `,
    )

    const timingNames: string[] = []
    const coverageKinds: string[] = []
    const typescriptPatch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file] })
    const nativePatch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({
      root,
      files: [file],
      semanticInstrumentation: {
        onTiming: (timing) => timingNames.push(timing.name),
        onNativeCoverage: (coverage) => coverageKinds.push(coverage.kind),
      },
    })

    expect(typescriptPatch.status).toBe('ok')
    expect(nativePatch.status).toBe('ok')
    expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
    expect(timingNames).toContain('semantic.native.extractor.direct_crux')
    expect(timingNames).not.toContain('semantic.analyzer.execution')
    expect(coverageKinds).toEqual(['complete-native'])
  }, 20_000)

  it('matches TypeScript facts while mixing native direct Crux projection with the shared analyzer', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const directFile = join(root, 'src/direct.ts')
    const sharedFile = join(root, 'src/memory.ts')
    await writeFile(
      directFile,
      `
        import { context, prompt } from '@crux/core'

        export const brandContext = context({ id: 'brand' })
        export const writerPrompt = prompt({
          id: 'writer-mixed',
          use: [brandContext],
        })
      `,
    )
    await writeFile(
      sharedFile,
      `
        import { memory } from '@crux/core/agent'

        export const sessionMemory = memory({ id: 'session' })
      `,
    )

    const coverageExtractors: string[][] = []
    const typescriptPatch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [directFile, sharedFile] })
    const nativePatch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({
      root,
      files: [directFile, sharedFile],
      semanticInstrumentation: {
        onNativeCoverage: (coverage) =>
          coverageExtractors.push('extractors' in coverage ? [...coverage.extractors] : []),
      },
    })

    expect(typescriptPatch.status).toBe('ok')
    expect(nativePatch.status).toBe('ok')
    expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
    expect(coverageExtractors).toEqual([['crux.direct-crux', 'crux.shared-analyzer']])
  }, 20_000)

  it('selects the experimental native backend from project config', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        export default config({
          experimental: {
            indexer: {
              native: true,
            },
          },
        })
      `,
    )
    await writeTsconfig(root)
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer' })
      `,
    )

    const patch = await indexProjectSemantic({ root })
    expect(patch.status).toBe('ok')
    expect(patch.facts.diagnostics ?? []).toEqual([])
  })
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
  return rows ? [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : undefined
}
