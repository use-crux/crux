import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject, indexProjectIncremental } from '..'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-incremental-source-profile-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('incremental source profile handoff', () => {
  it('carries AST source-profile rows on partial source patches', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/writer.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      file,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer', prompt: 'Draft.' })
      `,
    )

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    await writeFile(
      file,
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer.next', prompt: 'Draft.' })
      `,
    )

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [file],
      mode: 'ast',
    })

    const [astPatch] = incremental.patches
    expect(astPatch?.semanticSourceProfile).toMatchObject({
      dependencyClosure: [file],
      complete: true,
    })
    expect(astPatch?.semanticSourceProfile?.files).toEqual([
      expect.objectContaining({
        file,
        sourceHash: expect.any(String),
        sourceBytes: expect.any(Number),
        hints: expect.objectContaining({
          nativeDirectCruxCandidate: true,
          cruxCallNames: ['prompt'],
        }),
      }),
    ])
    expect(astPatch?.semanticSourceProfile?.files[0]).not.toHaveProperty('source')
    expect(incremental.report).toMatchObject({
      patchCounts: { ast: 1, semantic: 0, total: 1 },
      sourceProfileFileCount: 1,
      semanticStatus: 'not-requested',
    })
    expect(incremental.report.durationMsByPhase).toMatchObject({
      planning: expect.any(Number),
      ast: expect.any(Number),
    })
  })
})
