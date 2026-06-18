import { describe, expect, it } from 'vitest'
import { convexSkillActivationPersistence } from '../skill'
import { inMemoryCruxStore } from '../memory'
import { runWithConvexCruxRuntime } from '../runtime'

describe('convexSkillActivationPersistence', () => {
  it('loads and saves skill activation snapshots through the active Crux store', async () => {
    const store = inMemoryCruxStore()
    const persistence = convexSkillActivationPersistence()

    await runWithConvexCruxRuntime({ ctx: {}, store }, async () => {
      await persistence.save(
        { threadId: 'thread-1' },
        {
          activeSkillIds: ['seo'],
          injectedSkillIds: ['seo'],
        },
      )

      await expect(store.get('convex-agent:thread-1:skills')).resolves.toMatchObject({
        activeSkillIds: ['seo'],
        injectedSkillIds: ['seo'],
      })
      await expect(persistence.load({ threadId: 'thread-1' })).resolves.toEqual({
        activeSkillIds: ['seo'],
        injectedSkillIds: ['seo'],
      })
    })
  })
})
