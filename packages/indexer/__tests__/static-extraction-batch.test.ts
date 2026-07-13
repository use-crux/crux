import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ProjectDefinitionKind } from '@use-crux/core/project-index'
import { facts, type IndexerExtension } from '../src/indexer/extensions'
import { cacheKeyInputFromSyntaxRecord } from '../src/indexer/static/extraction/cache-key'
import {
  createStaticExtraction,
  type SourceReader,
} from '../src/indexer/static/extraction/engine'
import { createParseMemo } from '../src/indexer/static/extraction/source-io'
import {
  createProvidedStaticSyntaxFrontend,
  createStaticRecordProjectionCache,
  createTypeScriptStaticSyntaxFrontend,
} from '../src/indexer/static-index/syntax'
import { createProvidedStaticSyntaxRecordCache } from '../src/indexer/static-index/syntax/record/provided-record-cache'
import type {
  ProvidedStaticSyntaxRecordProvider,
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
} from '../src/indexer/static-index/syntax'

describe('static extraction batch frontend', () => {
  it('uses a frontend batch parser for cache-disabled multi-file extraction', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const sources = {
      [files[0]]: "export const a = 'a'",
      [files[1]]: "export const b = 'b'",
    }
    let parseFileCalls = 0
    let parseFilesCalls = 0
    const frontend: StaticSyntaxFrontend & {
      parseFiles(
        inputs: readonly StaticSyntaxFileInput[],
      ): Promise<readonly StaticSyntaxFileRecord[]>
    } = {
      name: 'oxc-rust',
      identity: { name: 'oxc-rust', version: 'test-batch' },
      parseFile: (input) => {
        parseFileCalls += 1
        return emptyRecord(input)
      },
      parseFiles: async (inputs) => {
        parseFilesCalls += 1
        return inputs.map(emptyRecord)
      },
    }
    const extraction = createStaticExtraction({
      root,
      cache: 'none',
      sources: memorySourceReader(sources),
      syntaxFrontend: frontend,
    })

    const results = await extraction.extractFiles(files, { concurrency: 8 })

    expect(results.map((result) => result.file)).toEqual(files)
    expect(parseFilesCalls).toBe(1)
    expect(parseFileCalls).toBe(0)
  })

  it('falls back to the frontend for imported records outside the batch', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const helperFile = '/fixture/src/helper.ts'
    const sources = {
      [files[0]]:
        "import { helper } from './helper'\nexport const a = helper()",
      [files[1]]: "export const b = 'b'",
      [helperFile]: "export function helper() { return 'helper' }",
    }
    let parseFileCalls = 0
    const frontend: StaticSyntaxFrontend & {
      parseFiles(
        inputs: readonly StaticSyntaxFileInput[],
      ): Promise<readonly StaticSyntaxFileRecord[]>
    } = {
      name: 'oxc-rust',
      identity: { name: 'oxc-rust', version: 'test-batch' },
      parseFile: (input) => {
        parseFileCalls += 1
        return emptyRecord(input)
      },
      parseFiles: async (inputs) =>
        inputs.map((input) =>
          input.file === files[0]
            ? recordWithImport(input, {
                localName: 'helper',
                importedName: 'helper',
                moduleSpecifier: './helper',
                resolvedFile: helperFile,
              })
            : emptyRecord(input),
        ),
    }
    const extraction = createStaticExtraction({
      root,
      cache: 'none',
      sources: memorySourceReader(sources),
      syntaxFrontend: frontend,
    })

    await extraction.extractFiles(files, { concurrency: 8 })

    expect(parseFileCalls).toBe(1)
  })

  it('uses a provided record batch reader for cache-enabled multi-file extraction misses', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const sources = {
      [files[0]]: "export const a = 'a'",
      [files[1]]: "export const b = 'b'",
    }
    const recordsByFile = new Map(
      files.map((file) => {
        const source = sources[file]
        if (source === undefined)
          throw new Error(`Missing fixture source: ${file}`)
        return [file, emptyRecord({ root, file, source })] as const
      }),
    )
    let readCalls = 0
    let readManyCalls = 0
    const provider: ProvidedStaticSyntaxRecordProvider = {
      identity: { name: 'oxc-rust', version: 'test-batch' },
      read: (file) => {
        readCalls += 1
        return recordsByFile.get(file)
      },
      readMany: (requestedFiles) => {
        readManyCalls += 1
        return new Map(
          requestedFiles.flatMap((file) => {
            const record = recordsByFile.get(file)
            return record ? [[file, record] as const] : []
          }),
        )
      },
    }
    const extraction = createStaticExtraction({
      root,
      cache: {
        get: async () => undefined,
        set: async () => undefined,
      },
      sources: memorySourceReader(sources),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({
        recordProvider: provider,
      }),
    })

    const results = await extraction.extractFiles(files, { concurrency: 8 })

    expect(results.map((result) => result.file)).toEqual(files)
    expect(readManyCalls).toBe(1)
    expect(readCalls).toBe(0)
  })

  it('uses validated cache hits without reading provided syntax records', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const sources = {
      [files[0]]: "export const a = 'a'",
      [files[1]]: "export const b = 'b'",
    }
    const cacheKeys = new Map([
      [files[0], 'cache:a'],
      [files[1], 'cache:b'],
    ])
    const extraction = createStaticExtraction({
      root,
      cache: {
        get: async (key) =>
          cachedExtraction(
            files.find((file) => cacheKeys.get(file) === key) ?? '/missing',
          ),
        set: async () => undefined,
      },
      cacheHits: files.map((file) => ({
        file,
        cacheKey: cacheKeys.get(file) ?? '',
      })),
      sources: memorySourceReader(sources),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({
        identity: { name: 'oxc-rust', version: 'test-batch' },
        recordProvider: {
          identity: { name: 'oxc-rust', version: 'test-batch' },
          read: () => {
            throw new Error('cache hits should not read syntax records')
          },
          readMany: () => {
            throw new Error('cache hits should not batch-read syntax records')
          },
        },
      }),
    })

    const results = await extraction.extractFiles(files, { concurrency: 8 })

    expect(results.map((result) => result.file)).toEqual(files)
    expect(results.every((result) => result.fromCache)).toBe(true)
  })

  it('reuses cached semantic profiles for validated cache hits', async () => {
    const root = '/fixture'
    const file = '/fixture/src/a.ts'
    const source = "export const a = 'a'"
    const cacheKey = 'cache:a'
    const timings: string[] = []
    const extraction = createStaticExtraction({
      root,
      cache: {
        get: async (key) =>
          key === cacheKey
            ? {
                ...cachedExtraction(file),
                semanticProfile: {
                  file,
                  sourceHash: createHash('sha256').update(source).digest('hex'),
                  sourceBytes: Buffer.byteLength(source, 'utf8'),
                },
              }
            : undefined,
        set: async () => undefined,
      },
      cacheHits: [{ file, cacheKey }],
      instrumentation: {
        onTiming: (timing) => timings.push(timing.name),
      },
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({
        identity: { name: 'oxc-rust', version: 'test-batch' },
        recordProvider: {
          identity: { name: 'oxc-rust', version: 'test-batch' },
          read: () => {
            throw new Error('cache hits should not read syntax records')
          },
        },
      }),
    })

    const [result] = await extraction.extractFiles([file], { concurrency: 8 })

    expect(result?.semanticProfile?.file).toBe(file)
    expect(timings).toContain('static.cache.read')
    expect(timings).not.toContain('static.semantic_profile')
  })

  it('isolates throwing extractors to the affected file during batch extraction', async () => {
    const root = '/fixture'
    const badFile = '/fixture/src/bad.ts'
    const goodFile = '/fixture/src/good.ts'
    const sources = {
      [badFile]: "export const bad = defineWorkflow({ id: 'bad' })",
      [goodFile]: "export const good = defineWorkflow({ id: 'good' })",
    }
    const workflowExtension: IndexerExtension = {
      name: '@acme/workflows',
      version: '1',
      extractors: [
        {
          name: 'workflow.define',
          patterns: [{ kind: 'call', name: 'defineWorkflow' }],
          extract: (ctx) => {
            const id = ctx.config?.string('id') ?? ctx.source.localName
            if (id === 'bad') throw new Error('bad workflow')
            return facts({
              definitions: [
                ctx.define.definition({
                  variableName: ctx.source.variableName,
                  id: `workflow:${id}`,
                  kind: 'workflow' as ProjectDefinitionKind,
                  name: id,
                }),
              ],
            })
          },
        },
      ],
    }
    const extraction = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: 'none',
      sources: memorySourceReader(sources),
      extensions: [workflowExtension],
    })

    const [bad, good] = await extraction.extractFiles([badFile, goodFile], {
      concurrency: 2,
    })

    expect(bad?.definitions).toEqual([])
    expect(bad?.diagnostics).toEqual([
      expect.objectContaining({ code: 'index.extractor_failed' }),
    ])
    expect(good?.diagnostics).toEqual([])
    expect(good?.definitions.map((definition) => definition.id)).toEqual([
      'workflow:good',
    ])
  })

  it('derives cache metadata from syntax-record imports without TypeScript AST input', async () => {
    const root = '/fixture'
    const file = '/fixture/src/a.ts'
    const dependency = '/fixture/src/helper.ts'
    const sources = {
      [file]: "import { helper } from './helper'\nexport const a = helper()",
      [dependency]: "export function helper() { return 'helper' }",
    }
    const parseMemo = createParseMemo(memorySourceReader(sources))

    const key = await cacheKeyInputFromSyntaxRecord({
      root,
      record: recordWithImport(
        {
          root,
          file,
          source: sources[file] ?? '',
        },
        {
          localName: 'helper',
          importedName: 'helper',
          moduleSpecifier: './helper',
          resolvedFile: dependency,
        },
      ),
      parseMemo,
      compilerInputs: [{ kind: 'syntax-frontend', name: 'oxc-rust' }],
    })

    expect(key?.file).toBe('src/a.ts')
    expect(key?.sourceHash).toBe(
      createHash('sha256')
        .update(sources[file] ?? '')
        .digest('hex'),
    )
    expect(key?.dependencies).toEqual([
      {
        file: 'src/helper.ts',
        sourceHash: createHash('sha256')
          .update(sources[dependency] ?? '')
          .digest('hex'),
      },
    ])
  })

  it('continues batch projection while an earlier cache write is pending', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const sources = {
      [files[0]]: "export const a = 'a'",
      [files[1]]: "export const b = 'b'",
    }
    const writes: string[] = []
    let releaseFirstWrite: (() => void) | undefined
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const frontend: StaticSyntaxFrontend & {
      parseFiles(
        inputs: readonly StaticSyntaxFileInput[],
      ): Promise<readonly StaticSyntaxFileRecord[]>
    } = {
      name: 'oxc-rust',
      identity: { name: 'oxc-rust', version: 'test-batch' },
      parseFile: emptyRecord,
      parseFiles: async (inputs) => inputs.map(emptyRecord),
    }
    const extraction = createStaticExtraction({
      root,
      cache: {
        get: async () => undefined,
        set: async (_key, value) => {
          writes.push(value.file)
          if (value.file === files[0]) await firstWrite
        },
      },
      sources: memorySourceReader(sources),
      syntaxFrontend: frontend,
    })

    const extractionPromise = extraction.extractFiles(files, {
      concurrency: 1,
    })

    await waitUntil(() => writes.includes(files[0]))
    await waitUntil(() => writes.includes(files[1]))
    let resolved = false
    extractionPromise.then(() => {
      resolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolved).toBe(false)

    releaseFirstWrite?.()
    await extractionPromise
    expect(resolved).toBe(true)
  })

  it('surfaces queued cache write failures before batch extraction resolves', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const sources = {
      [files[0]]: "export const a = 'a'",
      [files[1]]: "export const b = 'b'",
    }
    const frontend: StaticSyntaxFrontend & {
      parseFiles(
        inputs: readonly StaticSyntaxFileInput[],
      ): Promise<readonly StaticSyntaxFileRecord[]>
    } = {
      name: 'oxc-rust',
      identity: { name: 'oxc-rust', version: 'test-batch' },
      parseFile: emptyRecord,
      parseFiles: async (inputs) => inputs.map(emptyRecord),
    }
    const extraction = createStaticExtraction({
      root,
      cache: {
        get: async () => undefined,
        set: async () => {
          throw new Error('cache write failed')
        },
      },
      sources: memorySourceReader(sources),
      syntaxFrontend: frontend,
    })

    await expect(
      extraction.extractFiles(files, { concurrency: 1 }),
    ).rejects.toThrow('cache write failed')
  })

  it('drains queued cache writes before rejecting a later batch failure', async () => {
    const root = '/fixture'
    const files = ['/fixture/src/a.ts', '/fixture/src/b.ts']
    const sources = {
      [files[0]]: "export const a = 'a'",
      [files[1]]: "export const b = 'b'",
    }
    const writes: string[] = []
    let releaseFirstWrite: (() => void) | undefined
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const frontend: StaticSyntaxFrontend & {
      parseFiles(
        inputs: readonly StaticSyntaxFileInput[],
      ): Promise<readonly StaticSyntaxFileRecord[]>
    } = {
      name: 'oxc-rust',
      identity: { name: 'oxc-rust', version: 'test-batch' },
      parseFile: emptyRecord,
      parseFiles: async (inputs) => inputs.map(emptyRecord),
    }
    const extraction = createStaticExtraction({
      root,
      cache: {
        get: async (key) => {
          if (key.includes('"file":"src/b.ts"'))
            throw new Error('cache read failed')
          return undefined
        },
        set: async (_key, value) => {
          writes.push(value.file)
          if (value.file === files[0]) await firstWrite
        },
      },
      sources: memorySourceReader(sources),
      syntaxFrontend: frontend,
    })

    const extractionPromise = extraction.extractFiles(files, {
      concurrency: 1,
    })
    extractionPromise.catch(() => undefined)
    let settled = false
    extractionPromise
      .finally(() => {
        settled = true
      })
      .catch(() => undefined)

    await waitUntil(() => writes.includes(files[0]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    releaseFirstWrite?.()
    await expect(extractionPromise).rejects.toThrow('cache read failed')
    expect(settled).toBe(true)
  })

  it('coalesces pass-local imported definition projection work', async () => {
    const cache = createStaticRecordProjectionCache()
    let loads = 0
    const loaded = await Promise.all([
      cache.readImportedDefinition({
        file: '/fixture/src/shared.ts',
        importedName: 'sharedPrompt',
        load: async () => {
          loads += 1
          await new Promise((resolve) => setTimeout(resolve, 10))
          return {
            id: 'prompt:shared',
            kind: 'prompt',
            name: 'sharedPrompt',
            fidelity: 'resolved',
          }
        },
      }),
      cache.readImportedDefinition({
        file: '/fixture/src/shared.ts',
        importedName: 'sharedPrompt',
        load: async () => {
          loads += 1
          return {
            id: 'prompt:other',
            kind: 'prompt',
            name: 'other',
            fidelity: 'resolved',
          }
        },
      }),
    ])

    expect(loaded.map((definition) => definition?.id)).toEqual([
      'prompt:shared',
      'prompt:shared',
    ])
    expect(loads).toBe(1)

    await cache.readImportedDefinition({
      file: '/fixture/src/shared.ts',
      importedName: 'otherPrompt',
      load: async () => {
        loads += 1
        return {
          id: 'prompt:other',
          kind: 'prompt',
          name: 'otherPrompt',
          fidelity: 'resolved',
        }
      },
    })
    expect(loads).toBe(2)
  })

  it('evicts rejected provided record loads so rebuild races recover', async () => {
    const root = '/fixture'
    const file = '/fixture/src/shared.ts'
    const record = emptyRecord({
      root,
      file,
      source: "export const shared = 'ready'",
    })
    const cache = createProvidedStaticSyntaxRecordCache(10)
    let loads = 0
    let ready = false

    await expect(
      cache.read(file, async () => {
        loads += 1
        if (!ready) throw new Error('record still being written')
        return record
      }),
    ).rejects.toThrow(/still being written/)

    ready = true
    await expect(
      cache.read(file, async () => {
        loads += 1
        return record
      }),
    ).resolves.toBe(record)
    expect(loads).toBe(2)
  })
})

function memorySourceReader(sources: Record<string, string>): SourceReader {
  return {
    read: async (file) => {
      const source = sources[file]
      if (source === undefined)
        throw new Error(`Missing fixture source: ${file}`)
      return source
    },
  }
}

function emptyRecord(input: StaticSyntaxFileInput): StaticSyntaxFileRecord {
  return {
    schemaVersion: 1,
    frontend: { name: 'oxc-rust', version: 'test-batch' },
    file: input.file,
    relativePath: input.file,
    sourceHash: createHash('sha256').update(input.source).digest('hex'),
    imports: [],
    matches: [],
    localInitializers: [],
    diagnostics: [],
  }
}

function recordWithImport(
  input: StaticSyntaxFileInput,
  importRecord: Omit<StaticSyntaxFileRecord['imports'][number], 'source'>,
): StaticSyntaxFileRecord {
  return {
    ...emptyRecord(input),
    imports: [
      {
        ...importRecord,
        source: {
          file: input.file,
          line: 1,
          column: 1,
        },
      },
    ],
  }
}

function cachedExtraction(file: string) {
  return {
    file,
    relativePath: file,
    definitions: [],
    relations: [],
    dependencies: [],
    diagnostics: [],
    fromCache: true,
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 5000)
      throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
