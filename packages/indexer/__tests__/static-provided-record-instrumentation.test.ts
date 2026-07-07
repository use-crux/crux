import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { StaticExtractionTiming } from '..'
import { indexProjectAstFromSyntaxRecordProviderForHost as indexProjectAstFromSyntaxRecordProvider } from '../host/static-index'
import { createProvidedStaticSyntaxFrontend, createTypeScriptStaticSyntaxFrontend } from '../indexer/static-index/syntax'
import { createRustOxcStaticSyntaxFrontend } from '../testing/rust-oxc-frontend'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-provided-record-instrumentation-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('provided static syntax record instrumentation', () => {
  it('splits serialized provider reads from JSON materialization', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const source = [
      "import { prompt } from '@use-crux/core'",
      '',
      "export const writerPrompt = prompt({ id: 'writer.serialized-provider' })",
    ].join('\n')
    await writeFile(file, source)

    const frontend = createRustOxcStaticSyntaxFrontend({ callNames: ['prompt'] })
    const record = await frontend.parseFile({ root, file, source })
    const serializedByFile = new Map([[file, JSON.stringify(record)]])
    const timings: StaticExtractionTiming[] = []

    const patch = await indexProjectAstFromSyntaxRecordProvider({
      root,
      projectName: 'provided-record-instrumentation',
      recordProvider: {
        identity: record.frontend,
        read: () => undefined,
        readSerialized: (requestedFile) => serializedByFile.get(requestedFile),
        readManySerialized: (requestedFiles) =>
          new Map(
            requestedFiles.flatMap((requestedFile) => {
              const serialized = serializedByFile.get(requestedFile)
              return serialized ? [[requestedFile, serialized] as const] : []
            }),
          ),
      },
      staticInstrumentation: {
        onTiming: (timing) => {
          timings.push(timing)
        },
      },
    })

    expect((patch.facts.definitions ?? []).map((definition) => definition.id)).toContain(
      'prompt:writer.serialized-provider',
    )
    expect(timings.map((timing) => timing.name)).toContain('static.syntax_record.provider_read')
    expect(timings.map((timing) => timing.name)).toContain('static.syntax_record.provider_json_parse')
  })

  it('memoizes provided records across batch and single-file reads', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const firstFile = join(root, 'src/first.ts')
    const secondFile = join(root, 'src/second.ts')
    const firstSource = "export const first = 'one'"
    const secondSource = "export const second = 'two'"
    await writeFile(firstFile, firstSource)
    await writeFile(secondFile, secondSource)

    const frontend = createTypeScriptStaticSyntaxFrontend()
    const firstRecord = await frontend.parseFile({ root, file: firstFile, source: firstSource })
    const secondRecord = await frontend.parseFile({ root, file: secondFile, source: secondSource })
    const serializedByFile = new Map([
      [firstFile, JSON.stringify(firstRecord)],
      [secondFile, JSON.stringify(secondRecord)],
    ])
    let readManyCount = 0
    let readCount = 0

    const provided = createProvidedStaticSyntaxFrontend({
      identity: firstRecord.frontend,
      recordCacheSize: 2,
      recordProvider: {
        identity: firstRecord.frontend,
        read: () => undefined,
        readSerialized: (file) => {
          readCount += 1
          return serializedByFile.get(file)
        },
        readManySerialized: (files) => {
          readManyCount += 1
          return new Map(files.flatMap((file) => {
            const serialized = serializedByFile.get(file)
            return serialized ? [[file, serialized] as const] : []
          }))
        },
      },
    })

    await provided.parseFiles?.([
      { root, file: firstFile, source: firstSource },
      { root, file: secondFile, source: secondSource },
    ])
    await provided.parseFile({ root, file: firstFile, source: firstSource })
    await provided.parseFile({ root, file: secondFile, source: secondSource })

    expect(readManyCount).toBe(1)
    expect(readCount).toBe(0)
  })
})
