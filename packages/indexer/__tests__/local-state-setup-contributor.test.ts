import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createSetupPlanner } from '@use-crux/core/setup'
import { createLocalStateSetupContributor } from '../src/indexer/setup/local-state-contributor'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Local state setup contributor', () => {
  it('reports and safely fixes an absent root .gitignore', async () => {
    const root = await fixture()
    const planner = createSetupPlanner([createLocalStateSetupContributor()])

    await expect(planner.check({ root, mode: 'check' })).resolves.toMatchObject({
      ok: true,
      findings: [
        {
          contributorId: 'local-state',
          code: 'LOCAL_STATE_NOT_GITIGNORED',
          severity: 'warning',
        },
      ],
    })
    await expect(planner.plan({ root, mode: 'plan' })).resolves.toMatchObject({
      actions: [
        {
          id: 'local-state.gitignore-crux',
          contributorId: 'local-state',
          classification: 'safe-additive',
        },
      ],
    })

    await expect(planner.apply({ root, mode: 'apply' })).resolves.toMatchObject({
      ok: true,
      findings: [],
      applied: [{ ok: true, actionId: 'local-state.gitignore-crux' }],
    })
    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe('.crux/\n')
  })

  it('appends to an empty root .gitignore', async () => {
    const root = await fixture('')

    await createSetupPlanner([createLocalStateSetupContributor()]).apply({
      root,
      mode: 'apply',
    })

    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe('.crux/\n')
  })

  it.each(['.crux\n', '.crux/\n', '/.crux\n', '/.crux/\n'])(
    'treats %s as an equivalent positive root rule',
    async (source) => {
      const root = await fixture(source)

      await expect(
        createSetupPlanner([createLocalStateSetupContributor()]).check({
          root,
          mode: 'check',
        }),
      ).resolves.toMatchObject({ findings: [] })
    },
  )

  it('preserves existing bytes and inserts a newline when appending', async () => {
    const root = await fixture('dist')

    await createSetupPlanner([createLocalStateSetupContributor()]).apply({
      root,
      mode: 'apply',
    })

    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe('dist\n.crux/\n')
  })

  it('appends when a later matching negation re-includes .crux', async () => {
    const root = await fixture('.crux/\n!.crux/\n')

    const planner = createSetupPlanner([createLocalStateSetupContributor()])
    await expect(planner.plan({ root, mode: 'plan' })).resolves.toMatchObject({
      actions: [expect.objectContaining({ id: 'local-state.gitignore-crux' })],
    })
    await planner.apply({ root, mode: 'apply' })

    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe('.crux/\n!.crux/\n.crux/\n')
  })

  it('does not write during check', async () => {
    const root = await fixture()

    await createSetupPlanner([createLocalStateSetupContributor()]).check({
      root,
      mode: 'check',
    })

    await expect(stat(join(root, '.gitignore'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('is idempotent across repeated apply', async () => {
    const root = await fixture('node_modules/\n')
    const planner = createSetupPlanner([createLocalStateSetupContributor()])

    await planner.apply({ root, mode: 'apply' })
    await planner.apply({ root, mode: 'apply' })

    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe('node_modules/\n.crux/\n')
  })
})

async function fixture(gitignore?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-local-state-setup-'))
  roots.push(root)
  if (gitignore !== undefined) {
    await writeFile(join(root, '.gitignore'), gitignore)
  }
  return root
}
