import { describe, expect, it } from 'vitest'
import { convexSkillActivationPersistence } from '../skill'
import { inMemoryRecordStore } from '../memory'
import { runWithConvexCruxRuntime } from '../runtime'

describe('convexSkillActivationPersistence', () => {
  it('loads and saves skill activation snapshots through the active Crux records', async () => {
    const records = inMemoryRecordStore()
    const persistence = convexSkillActivationPersistence()

    await runWithConvexCruxRuntime({ ctx: {}, storage: { records }, records }, async () => {
      await persistence.save(
        { threadId: 'thread-1' },
        {
          activeSkillIds: ['seo'],
          injectedSkillIds: ['seo'],
        },
      )

      await expect(records.get('convex-agent:thread-1:skills')).resolves.toMatchObject({
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
