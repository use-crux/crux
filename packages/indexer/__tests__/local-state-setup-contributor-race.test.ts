import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSetupPlanner } from '@use-crux/core/setup'

const roots: string[] = []
const state = vi.hoisted(() => ({ injectConcurrentAppend: true }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      const result = await actual.readFile(...args)
      if (state.injectConcurrentAppend && String(args[0]).endsWith('.gitignore')) {
        state.injectConcurrentAppend = false
        await actual.appendFile(args[0], 'concurrent\n')
      }
      return result
    }),
  }
})

afterEach(async () => {
  state.injectConcurrentAppend = true
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Local state setup contributor races', () => {
  it('does not overwrite bytes appended after its stale read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-local-state-setup-race-'))
    roots.push(root)
    await writeFile(join(root, '.gitignore'), 'dist\n')

    const { createLocalStateSetupContributor } = await import('../src/indexer/setup/local-state-contributor')
    await createSetupPlanner([createLocalStateSetupContributor()]).apply({
      root,
      mode: 'apply',
    })

    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe('dist\nconcurrent\n.crux/\n')
  })
})
