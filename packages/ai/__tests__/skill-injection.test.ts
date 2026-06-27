import { describe, expect, it, vi } from 'vitest'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { createSkillActivationSession, skill } from '@use-crux/core/skill'
import { injectNewlyActivatedSkills } from '../agent/skill-injection'

describe('injectNewlyActivatedSkills', () => {
  it('injects from an explicit skill activation session and marks the skills injected', () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })
    const session = createSkillActivationSession({ skills: [seo] })
    session.activate('seo')
    const params = {
      prompt: [{ role: 'system', content: 'Base instructions.' }],
    } as LanguageModelV3CallOptions
    const onSkillResolve = vi.fn()

    injectNewlyActivatedSkills(params, { onSkillResolve }, session)

    expect((params.prompt as Array<{ content: string }>)[0]?.content).toContain('## Skill: seo')
    expect(onSkillResolve).toHaveBeenCalledWith({ skillId: 'seo' })
    expect(session.newlyActivated()).toEqual([])
  })
})
