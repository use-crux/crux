import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectProjectStaticSyntaxPlan } from '../src/host/static-index'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-syntax-plan-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('static syntax plan support files', () => {
  it('includes resolved helper-only imports needed by record-backed source refs', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const contextFile = join(root, 'src/context.ts')
    const helperFile = join(root, 'src/plans.ts')
    const contextSource = [
      "import { context } from '@use-crux/core'",
      "import { getPlan } from './plans'",
      '',
      'export const planContext = context({',
      "  id: 'plan',",
      '  system: async () => {',
      '    await getPlan()',
      "    return ''",
      '  },',
      '})',
    ].join('\n')
    const helperSource = "export async function getPlan() {\n  return null\n}\n"

    await writeFile(contextFile, contextSource)
    await writeFile(helperFile, helperSource)

    const plan = await inspectProjectStaticSyntaxPlan({ root, projectName: 'support-files', includeCacheStatus: true })

    expect(plan.files).toContain(contextFile)
    expect(plan.files).toContain(helperFile)
    expect(plan.filesToParse).toContain(contextFile)
    expect(plan.filesToParse).toContain(helperFile)

    expect(plan.cacheHits).toEqual([])
  })
})
