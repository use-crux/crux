import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cruxCoreCompilerProfile } from '../src/indexer/compiler/profile'
import { createStaticExtraction } from '../src/indexer/static/extraction/engine'
import { staticParseCacheManifestStatus } from '../src/indexer/static/extraction/cache'
import { createTypeScriptStaticSyntaxFrontend } from '../src/indexer/static-index/syntax'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('Safety strategy cache identity', () => {
  it('invalidates warm static output when its projector identity changes', async () => {
    const root = await mkdtemp(
      join(process.cwd(), '.tmp-safety-strategy-cache-'),
    )
    roots.push(root)
    const file = join(root, 'src/policy.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      file,
      [
        "import { boundary, guardrail } from '@use-crux/core/safety'",
        'export const policy = guardrail({',
        "  id: 'classified-media',",
        '  on: boundary.input.media(),',
        '  run: guardrail.mediaClassifier(options),',
        '})',
      ].join('\n'),
    )
    const base = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    })
    expect(base.identity.cacheInputs).toContainEqual({
      kind: 'compiler-projection',
      name: 'safety-strategy-facts',
      version: '3',
      phase: 'extract',
    })
    await base.extractFile(file)
    await expect(cacheStatus(root, file, base.identity.cacheInputs))
      .resolves.toMatchObject({ cacheHits: [file], cacheMisses: [] })

    const changed = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      profile: {
        ...cruxCoreCompilerProfile,
        projections: cruxCoreCompilerProfile.projections.map((projection) =>
          projection.name === 'safety-strategy-facts'
            ? { ...projection, version: 'changed' }
            : projection,
        ),
      },
    })

    await expect(cacheStatus(root, file, changed.identity.cacheInputs))
      .resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] })
  })
})

function cacheStatus(
  root: string,
  file: string,
  compilerInputs: Parameters<typeof staticParseCacheManifestStatus>[0]['compilerInputs'],
) {
  return staticParseCacheManifestStatus({
    root,
    files: [file],
    compilerInputs,
  })
}
