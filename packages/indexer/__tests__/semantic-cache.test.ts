import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SEMANTIC_FACTS_CACHE_EPOCH } from '../indexer/cache-identity'
import type { IndexPatch, IndexPatchFacts } from '../indexer/patches'
import { semanticIndexFactsCached } from '../indexer/semantic-cache'
import type { SemanticBackendIdentity, SemanticCompilerRuntimeIdentity } from '../indexer/semantic/service'
import type { SemanticSourceProfile } from '../indexer/semantic/source-profile'
import { indexPatchFromWorkerEvents, indexPatchToWorkerEvents } from '../contracts/worker-events'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = join(process.cwd(), `.tmp-semantic-cache-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  roots.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic facts cache', () => {
  it('writes and reads binary semantic fact caches without rerunning the producer', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = true`)
    const backendIdentity: SemanticBackendIdentity = { name: 'test-cache', version: 'v1' }
    const facts = cachedFacts()
    let producerCalls = 0
    const timingNames: string[] = []

    const first = await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      instrumentation: { onTiming: (timing) => timingNames.push(timing.name) },
      async *produceEvidence() {
        producerCalls += 1
        yield { kind: 'definitions', facts: facts.definitions ?? [] }
        yield { kind: 'diagnostics', facts: [] }
      },
    })

    expect(first.definitions).toEqual(facts.definitions)
    expect(producerCalls).toBe(1)
    await expect(cacheFileNames(root)).resolves.toEqual([expect.stringMatching(/\.bin$/)])

    const second = await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      instrumentation: { onTiming: (timing) => timingNames.push(timing.name) },
      async *produceEvidence() {
        throw new Error('producer should not run for semantic cache hits')
      },
    })

    expect(second.definitions).toEqual(facts.definitions)
    expect(producerCalls).toBe(1)
    expect(timingNames).toContain('semantic.cache.miss')
    expect(timingNames).toContain('semantic.cache.hit')
  })

  it('ignores JSON semantic fact caches after the hard binary cache migration', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = true`)
    const backendIdentity: SemanticBackendIdentity = { name: 'test-cache-json', version: 'v1' }
    const facts = cachedFacts()

    await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      async *produceEvidence() {
        yield { kind: 'definitions', facts: facts.definitions ?? [] }
        yield { kind: 'diagnostics', facts: [] }
      },
    })

    const cacheDir = join(root, '.crux/cache/index', SEMANTIC_FACTS_CACHE_EPOCH)
    const [binaryName] = await cacheFileNames(root)
    expect(binaryName).toMatch(/\.bin$/)
    await rm(join(cacheDir, binaryName))
    await writeFile(join(cacheDir, binaryName.replace(/\.bin$/, '.json')), JSON.stringify(facts), 'utf8')

    let producerCalls = 0
    const cached = await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      async *produceEvidence() {
        producerCalls += 1
        yield { kind: 'definitions', facts: facts.definitions ?? [] }
        yield { kind: 'diagnostics', facts: [] }
      },
    })

    expect(cached.definitions).toEqual(facts.definitions)
    expect(producerCalls).toBe(1)
    await expect(cacheFileNames(root)).resolves.toEqual([
      expect.stringMatching(/\.bin$/),
      expect.stringMatching(/\.json$/),
    ])
  })

  it('uses order-insensitive source profile cache identity', async () => {
    const root = await fixtureRoot()
    const left = join(root, 'src/left.ts')
    const right = join(root, 'src/right.ts')
    await writeFile(left, `export const left = true`)
    await writeFile(right, `export const right = true`)
    const backendIdentity: SemanticBackendIdentity = { name: 'test-cache-order', version: 'v1' }
    const facts = cachedFacts()
    const timingNames: string[] = []
    let producerCalls = 0

    await semanticIndexFactsCached(root, [left, right], {
      backendIdentity,
      sourceProfile: semanticSourceProfileFixture(root, [left, right]),
      instrumentation: { onTiming: (timing) => timingNames.push(timing.name) },
      async *produceEvidence() {
        producerCalls += 1
        yield { kind: 'definitions', facts: facts.definitions ?? [] }
      },
    })

    const cached = await semanticIndexFactsCached(root, [right, left], {
      backendIdentity,
      sourceProfile: semanticSourceProfileFixture(root, [right, left]),
      instrumentation: { onTiming: (timing) => timingNames.push(timing.name) },
      async *produceEvidence() {
        throw new Error('producer should not run for equivalent semantic source profile order')
      },
    })

    expect(cached.definitions).toEqual(facts.definitions)
    expect(producerCalls).toBe(1)
    expect(timingNames).toContain('semantic.cache.miss')
    expect(timingNames).toContain('semantic.cache.hit')
    await expect(cacheFileNames(root)).resolves.toHaveLength(1)
  })

  it('does not reuse semantic facts from incomplete source profiles round-tripped through worker events', async () => {
    const root = await fixtureRoot()
    const writer = join(root, 'src/writer.ts')
    const helper = join(root, 'src/helper.ts')
    await writeFile(writer, `export const writer = true`)
    await writeFile(helper, `export const helper = true`)
    const backendIdentity: SemanticBackendIdentity = { name: 'test-cache-incomplete-profile', version: 'v1' }
    const facts = cachedFacts()
    let producerCalls = 0
    const timingNames: string[] = []
    const sourceProfile = semanticSourceProfileFixture(root, [writer])

    const streamedPatch = indexPatchFromWorkerEvents(
      indexPatchToWorkerEvents(
        {
          schemaVersion: 1,
          phase: 'ast',
          project: { root, name: 'semantic-cache' },
          startedAt: '2026-07-06T10:00:00.000Z',
          finishedAt: '2026-07-06T10:00:00.001Z',
          status: 'partial',
          facts: {},
          semanticSourceProfile: {
            ...sourceProfile,
            dependencyClosure: [helper, writer].sort(),
            sourceBytes: sourceProfile.sourceBytes + 24,
            complete: false,
          },
        } satisfies IndexPatch,
        {
          transactionId: 'tx-incomplete-profile',
          producer: { name: '@use-crux/indexer', version: 'test' },
        },
      ),
    )

    expect(streamedPatch.semanticSourceProfile).toMatchObject({
      complete: false,
      dependencyClosure: [helper, writer].sort(),
      sourceBytes: sourceProfile.sourceBytes + 24,
    })

    for (let index = 0; index < 2; index += 1) {
      await semanticIndexFactsCached(root, [writer], {
        backendIdentity,
        sourceProfile: streamedPatch.semanticSourceProfile,
        instrumentation: { onTiming: (timing) => timingNames.push(timing.name) },
        async *produceEvidence() {
          producerCalls += 1
          yield { kind: 'definitions', facts: facts.definitions ?? [] }
          yield { kind: 'diagnostics', facts: [] }
        },
      })
    }

    expect(producerCalls).toBe(2)
    expect(timingNames).toEqual(expect.arrayContaining(['semantic.cache.unkeyed']))
    await expect(cacheFileNames(root)).rejects.toThrow()
  })

  it('normalizes relative and absolute source profile files', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = true`)
    const backendIdentity: SemanticBackendIdentity = { name: 'test-cache-paths', version: 'v1' }
    const facts = cachedFacts()
    let producerCalls = 0

    await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      sourceProfile: semanticSourceProfileFixture(root, [file]),
      async *produceEvidence() {
        producerCalls += 1
        yield { kind: 'definitions', facts: facts.definitions ?? [] }
      },
    })

    const cached = await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      sourceProfile: semanticSourceProfileFixture(root, ['src/writer.ts']),
      async *produceEvidence() {
        throw new Error('producer should not run for equivalent semantic source profile paths')
      },
    })

    expect(cached.definitions).toEqual(facts.definitions)
    expect(producerCalls).toBe(1)
    await expect(cacheFileNames(root)).resolves.toHaveLength(1)
  })

  it('keys durable fact caches by compiler runtime identity', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = true`)
    const backendIdentity: SemanticBackendIdentity = { name: 'test-cache-runtime', version: 'v1' }
    const firstRuntime: SemanticCompilerRuntimeIdentity = { name: 'typescript', version: '5.9.3' }
    const secondRuntime: SemanticCompilerRuntimeIdentity = {
      name: 'tsgo',
      version: 'native-preview-v1',
      executable: '/opt/tsgo',
    }
    let producerCalls = 0

    await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      compilerRuntime: firstRuntime,
      async *produceEvidence() {
        producerCalls += 1
        yield { kind: 'definitions', facts: cachedFacts().definitions ?? [] }
      },
    })

    await semanticIndexFactsCached(root, [file], {
      backendIdentity,
      compilerRuntime: secondRuntime,
      async *produceEvidence() {
        producerCalls += 1
        yield { kind: 'definitions', facts: cachedFacts().definitions ?? [] }
      },
    })

    expect(producerCalls).toBe(2)
    await expect(cacheFileNames(root)).resolves.toHaveLength(2)
  })
})

function cachedFacts(): IndexPatchFacts {
  return {
    definitions: [
      {
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        fidelity: 'resolved',
        status: 'active',
      },
    ],
    diagnostics: [],
  }
}

async function cacheFileNames(root: string): Promise<readonly string[]> {
  return (await readdir(join(root, '.crux/cache/index', SEMANTIC_FACTS_CACHE_EPOCH))).sort()
}

function semanticSourceProfileFixture(root: string, files: readonly string[]): SemanticSourceProfile {
  return {
    files: files.map((file) => ({
      file,
      sourceHash: file.endsWith('left.ts') ? 'left-hash' : 'right-hash',
      sourceBytes: 24,
    })),
    dependencyClosure: files,
    sourceBytes: files.length * 24,
    complete: true,
  }
}
