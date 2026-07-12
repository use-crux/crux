import { describe, expect, it } from 'vitest'
import { node, inMemoryRuntimeStore, type RuntimeSetupPort } from '@use-crux/core/runtime'
import { createRuntimeSetupContributor } from '../src/indexer/setup/runtime-contributor'

describe('Runtime setup contributor', () => {
  it('maps findings and safely applies unhealthy setup', async () => {
    let healthy = false
    const setup: RuntimeSetupPort = {
      check: async () => ({ ok: healthy, findings: healthy ? [] : [{ code: 'TABLE_MISSING', resource: 'work', message: 'missing', remediation: 'CREATE TABLE work' }] }),
      apply: async () => { healthy = true; return { ok: true, findings: [] } },
    }
    const store = inMemoryRuntimeStore()
    const runtime = node({ store: { ...store, setup }, autoStartMaintenance: false })
    const contributor = createRuntimeSetupContributor(runtime)
    expect(await contributor.inspect({ root: '/project', mode: 'check' })).toEqual([expect.objectContaining({ contributorId: 'runtime', severity: 'error', code: 'TABLE_MISSING' })])
    const [action] = await contributor.plan({ root: '/project', mode: 'plan' })
    expect(action).toMatchObject({ classification: 'safe-additive' })
    expect((await contributor.apply!(action!, { root: '/project', mode: 'apply' })).ok).toBe(true)
    expect(await contributor.inspect({ root: '/project', mode: 'check' })).toEqual([])
  })
})
