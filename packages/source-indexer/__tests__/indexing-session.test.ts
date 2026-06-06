import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject } from '../index'
import { runSourceOnlyProjectIndexingSession } from '../indexer/session'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-indexing-session-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project indexing session', () => {
  it('runs a source-only catalog session behind a testable boundary', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        throw new Error('source-only sessions must not import config modules')

        export default config({})
      `,
    )

    const sessionSnapshot = await runSourceOnlyProjectIndexingSession({ root, projectName: 'fixture' })
    const entryPointSnapshot = await indexProject({ root, projectName: 'fixture', staticOnly: true })

    expect(sessionSnapshot.definitions).toContainEqual(
      expect.objectContaining({ id: 'prompt:writer', kind: 'prompt', fidelity: 'resolved' }),
    )
    expect(sessionSnapshot.diagnostics).toContainEqual(expect.objectContaining({ code: 'catalog.static_only' }))
    expect(sessionSnapshot.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'catalog.config_import_failed' }),
    )
    expect(sessionSnapshot.sources).toContainEqual(
      expect.objectContaining({
        file: join(root, 'crux.config.ts'),
        status: 'partial',
        diagnostics: expect.arrayContaining([expect.stringContaining('catalog:static-only')]),
      }),
    )
    expect(stableCatalogFacts(sessionSnapshot)).toEqual(stableCatalogFacts(entryPointSnapshot))
  })
})

function stableCatalogFacts(snapshot: Awaited<ReturnType<typeof indexProject>>): {
  definitionIds: string[]
  diagnosticCodes: string[]
  sourceStatuses: Array<{ file: string; status: string }>
} {
  return {
    definitionIds: snapshot.definitions.map((definition) => definition.id).sort(),
    diagnosticCodes: snapshot.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    sourceStatuses: snapshot.sources
      .map((source) => ({ file: source.file, status: source.status }))
      .sort((a, b) => a.file.localeCompare(b.file)),
  }
}
