import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexPatchFacts } from '../src/indexer/patches'
import { semanticSourceProfileFileFromSource } from '../src/indexer/semantic/source-profile'
import {
  createSemanticIndexService,
  type SemanticAnalyzeInput,
  type SemanticBackend,
  type SemanticBackendSessionInput,
} from '../src/indexer/semantic/service'
const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-service-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic index service', () => {
  it('runs semantic facts through a backend boundary with a session identity', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@use-crux/core'
        export const writer = prompt({ id: 'writer' })
      `,
    )

    const sessionCalls: SemanticBackendSessionInput[] = []
    const analyzeCalls: SemanticAnalyzeInput[] = []
    const facts: IndexPatchFacts = {
      definitions: [{ id: 'prompt:writer', kind: 'prompt', name: 'writer', fidelity: 'resolved', status: 'active' }],
      diagnostics: [],
    }
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      compilerRuntimeIdentity() {
        return { name: 'test-compiler', version: 'v2', executable: '/opt/test-compiler' }
      },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        sessionCalls.push(input)
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: facts.definitions ?? [] }
            yield { kind: 'diagnostics', facts: [] }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [join(root, 'src/writer.ts')],
      projectName: 'semantic-service',
    })
    expect(patch.status).toBe('ok')
    expect(patch.semanticBackend).toBe('test-semantic')
    expect(patch.facts.definitions).toEqual(facts.definitions)
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0]).toMatchObject({
      root,
      identity: {
        root,
        backend: { name: 'test-semantic', version: 'v1' },
        compilerRuntime: { name: 'test-compiler', version: 'v2', executable: '/opt/test-compiler' },
        tsconfigFiles: [join(root, 'tsconfig.json')],
      },
    })
    expect(sessionCalls[0]?.identity.compilerOptionsId).toContain('ts-bundler')
    expect(analyzeCalls).toEqual([
      expect.objectContaining({
        root,
        files: [join(root, 'src/writer.ts')],
      }),
    ])
  })

  it('uses caller-provided semantic dependency closure for scoped indexing', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
    await writeFile(join(root, 'src/writer.ts'), `export const writer = true`)
    await writeFile(join(root, 'src/shared.ts'), `export const shared = true`)

    const analyzeCalls: SemanticAnalyzeInput[] = []
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: [] }
          },
        }
      },
    }

    const dependencyClosure = [join(root, 'src/shared.ts'), join(root, 'src/writer.ts')]
    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [join(root, 'src/writer.ts')],
      dependencyClosure,
      projectName: 'semantic-service',
    })

    expect(patch.status).toBe('ok')
    expect(analyzeCalls).toHaveLength(1)
    expect(analyzeCalls[0]?.dependencyClosure).toEqual(dependencyClosure)
  })

  it('passes preflight source profile evidence to semantic backends', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    await writeFile(file, `export const writer = true`)

    const analyzeCalls: SemanticAnalyzeInput[] = []
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: [] }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [file],
      projectName: 'semantic-service',
    })

    expect(patch.status).toBe('ok')
    expect(analyzeCalls[0]?.sourceProfile.files).toEqual([
      expect.objectContaining({
        file,
        sourceBytes: Buffer.byteLength(`export const writer = true`, 'utf8'),
        sourceHash: expect.any(String),
      }),
    ])
  })

  it('reuses caller-provided source profile evidence during full project semantic indexing', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
    const file = join(root, 'src/writer.ts')
    const source = `
      import { prompt } from '@use-crux/core'
      export const writer = prompt({ id: 'writer' })
    `
    await writeFile(file, source)

    const semanticProfile = semanticSourceProfileFileFromSource(file, source)
    const analyzeCalls: SemanticAnalyzeInput[] = []
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: [] }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexProject({
      root,
      projectName: 'semantic-service',
      sourceProfile: {
        files: [semanticProfile],
        dependencyClosure: [file],
        sourceBytes: semanticProfile.sourceBytes,
        complete: true,
      },
    })

    expect(patch.status).toBe('ok')
    expect(analyzeCalls[0]?.sourceProfile.files).toEqual([semanticProfile])
  })

  it('narrows superset source profiles to the semantic dependency closure', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const writer = join(root, 'src/writer.ts')
    const helper = join(root, 'src/helper.ts')
    const writerSource = `import { prompt } from '@use-crux/core'\nexport const writer = prompt({ id: 'writer' })`
    const helperSource = `export const helper = true`
    await writeFile(writer, writerSource)
    await writeFile(helper, helperSource)

    const writerProfile = semanticSourceProfileFileFromSource(writer, writerSource)
    const helperProfile = semanticSourceProfileFileFromSource(helper, helperSource)
    const analyzeCalls: SemanticAnalyzeInput[] = []
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: [] }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [writer],
      projectName: 'semantic-service',
      sourceProfile: {
        files: [helperProfile, writerProfile],
        dependencyClosure: [],
        sourceBytes: helperProfile.sourceBytes + writerProfile.sourceBytes,
        complete: true,
      },
    })

    expect(patch.status).toBe('ok')
    expect(analyzeCalls[0]?.dependencyClosure).toEqual([writer])
    expect(analyzeCalls[0]?.sourceProfile).toEqual({
      files: [writerProfile],
      dependencyClosure: [writer],
      sourceBytes: writerProfile.sourceBytes,
      complete: true,
    })
  })

  it('uses source-profile hints to avoid analyzing files without semantic primitive calls', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }))
    const writer = join(root, 'src/writer.ts')
    const helper = join(root, 'src/helper.ts')
    const writerSource = `
      import { prompt } from '@use-crux/core'
      export const writer = prompt({ id: 'writer' })
    `
    const helperSource = `
      import type { PromptMeta } from '@use-crux/core/project-index'
      export const helper = {} satisfies Partial<PromptMeta>
    `
    await writeFile(writer, writerSource)
    await writeFile(helper, helperSource)

    const writerProfile = semanticSourceProfileFileFromSource(writer, writerSource)
    const helperProfile = semanticSourceProfileFileFromSource(helper, helperSource)
    const analyzeCalls: SemanticAnalyzeInput[] = []
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: [] }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexProject({
      root,
      projectName: 'semantic-service',
      sourceProfile: {
        files: [helperProfile, writerProfile],
        dependencyClosure: [helper, writer].sort(),
        sourceBytes: helperProfile.sourceBytes + writerProfile.sourceBytes,
        complete: true,
      },
    })

    expect(patch.status).toBe('ok')
    expect(analyzeCalls[0]?.files).toEqual([writer])
    expect(analyzeCalls[0]?.dependencyClosure).toEqual([helper, writer].sort())
  })

  it('uses previous source graph dependency closure for scoped indexing', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const shared = join(root, 'src/shared.ts')
    await writeFile(file, `export const writer = true`)
    await writeFile(shared, `export const shared = true`)

    const analyzeCalls: SemanticAnalyzeInput[] = []
    const backend: SemanticBackend<'test-semantic'> = {
      identity: { name: 'test-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze(analyzeInput) {
            analyzeCalls.push(analyzeInput)
            yield { kind: 'definitions', facts: [] }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [file],
      previousIndex: {
        schemaVersion: 1,
        project: { root },
        indexedAt: new Date(0).toISOString(),
        prompts: [],
        contexts: [],
        definitions: [],
        relations: [],
        diagnostics: [],
        lintFindings: [],
        ruleDescriptors: [],
        sources: [
          { file, status: 'indexed', dependencies: [shared] },
          { file: shared, status: 'indexed' },
        ],
        sourceGraph: {
          schemaVersion: 1,
          producedBy: '@use-crux/indexer',
          capabilities: ['source-dependencies'],
        },
      },
      projectName: 'semantic-service',
    })

    expect(patch.status).toBe('ok')
    expect(analyzeCalls[0]?.dependencyClosure).toEqual([shared, file].sort())
  })

  it('materializes streamed semantic evidence into an index patch', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src/writer.ts'), `export const writer = 'writer'`)

    const backend: SemanticBackend<'streaming-semantic'> = {
      identity: { name: 'streaming-semantic', version: 'v1' },
      capabilities: {
        apiStability: 'stable',
        factProduction: 'complete',
        sessionReuse: 'none',
        transport: 'in-process',
      },
      createSession(input) {
        return {
          identity: input.identity,
          async *analyze() {
            yield {
              kind: 'definitions',
              facts: [{ id: 'prompt:first', kind: 'prompt', name: 'first', fidelity: 'resolved', status: 'active' }],
            }
            yield {
              kind: 'definitions',
              facts: [{ id: 'prompt:second', kind: 'prompt', name: 'second', fidelity: 'resolved', status: 'active' }],
            }
          },
        }
      },
    }

    const patch = await createSemanticIndexService({ backend }).indexFiles({
      root,
      files: [join(root, 'src/writer.ts')],
      projectName: 'streaming-semantic-service',
    })
    expect(patch.status).toBe('ok')
    expect(patch.facts.definitions?.map((definition) => definition.id)).toEqual(['prompt:first', 'prompt:second'])
  })
})
