import { describe, expect, it, vi } from 'vitest'
import { createAgentSkillKit, createSkillActivationSession, skill } from '../../skill'
import type { SkillActivationSnapshot } from '../../skill'

describe('createAgentSkillKit', () => {
  it('loads and saves snapshots through the session persistence port', async () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })
    let session = createSkillActivationSession({ skills: [seo] })
    const target = { threadId: 'thread-1' }
    const persistence = {
      load: vi.fn(
        async (): Promise<SkillActivationSnapshot | null> => ({
          activeSkillIds: ['seo'],
          injectedSkillIds: ['seo'],
        }),
      ),
      save: vi.fn(async () => undefined),
    }
    const prompt = {
      resolve: vi.fn(async () => ({
        tools: session.tools(),
        _skillSession: session,
      })),
    }

    const kit = await createAgentSkillKit(prompt, { target, persistence })

    expect(await kit.resolveInput({ topic: 'pricing' })).toEqual({
      topic: 'pricing',
      _crux_activeSkills: ['seo'],
    })

    session = createSkillActivationSession({ skills: [seo] })
    await kit.tools.__crux_LoadSkill.execute({ name: 'seo' })

    expect(persistence.save).toHaveBeenCalledWith(target, {
      activeSkillIds: ['seo'],
      injectedSkillIds: [],
    })
  })
})
