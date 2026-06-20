import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SEMANTIC_FACTS_CACHE_EPOCH } from '../indexer/cache-identity'
import type { IndexPatchFacts } from '../indexer/patches'
import { semanticIndexFactsCached } from '../indexer/semantic-cache'
import type { SemanticBackendIdentity } from '../indexer/semantic/service'

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

    const first = await semanticIndexFactsCached(root, [file], {
      backendIdentity,
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
      async *produceEvidence() {
        throw new Error('producer should not run for semantic cache hits')
      },
    })

    expect(second.definitions).toEqual(facts.definitions)
    expect(producerCalls).toBe(1)
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
