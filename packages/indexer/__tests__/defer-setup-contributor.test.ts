import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createDeferSetupContributor } from '../src/indexer/setup/defer-contributor'

describe('defer setup contributor', () => {
  it('reports exact Next integration and named durability remediation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '^16' } }))
    const findings = await createDeferSetupContributor({ hasRuntime: false }).inspect({ root, mode: 'check' })
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DEFER_NEXT_INTEGRATION_MISSING', docsUrl: expect.stringContaining('/defer/troubleshooting'), remediation: 'pnpm add @use-crux/next' }),
      expect.objectContaining({ code: 'DEFER_RUNTIME_NOT_CONFIGURED', agentPrompt: expect.stringContaining('Runtime Engine') }),
    ]))
  })
})
