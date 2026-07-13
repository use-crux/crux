import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runSetupOperation } from '../src/indexer/setup-ops'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('runSetupOperation', () => {
  it('aggregates non-Runtime contributors in a configless project', async () => {
    const root = await fixture({ dependencies: { next: '^16.0.0' } })
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/route.ts'),
      "import { defer } from '@use-crux/core';\nawait defer(sendReceipt, input)",
    )

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributorId: 'defer',
          code: 'DEFER_NEXT_INTEGRATION_MISSING',
        }),
        expect.objectContaining({
          contributorId: 'defer',
          code: 'DEFER_RUNTIME_NOT_CONFIGURED',
        }),
      ]),
    )
  })

  it('contains malformed project metadata without leaking its contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-setup-ops-'))
    roots.push(root)
    await writeFile(join(root, 'package.json'), '{ "password": "secret" ')

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report).toMatchObject({
      ok: false,
      findings: [
        {
          contributorId: 'defer',
          code: 'SETUP_CONTRIBUTOR_FAILED',
        },
      ],
    })
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('contains config evaluation failures and still runs sibling contributors', async () => {
    const root = await fixture({
      dependencies: { '@use-crux/core': 'workspace:*' },
    })
    await writeFile(
      join(root, 'crux.config.ts'),
      "throw new Error('DATABASE_URL=postgres://admin:secret@db/crux')",
    )

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributorId: 'project-config',
          code: 'SETUP_CONTRIBUTOR_FAILED',
        }),
      ]),
    )
    expect(JSON.stringify(report)).not.toContain('admin')
    expect(JSON.stringify(report)).not.toContain('secret')
  })
})

async function fixture(manifest: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-setup-ops-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  return root
}
