import { describe, expect, it } from 'vitest'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { observe, subscribeObservability, type CruxGraphRecord } from '@use-crux/core/observability'
import { createSkillActivationSession, skill } from '@use-crux/core/skill'
import { injectNewlyActivatedSkills } from '../agent/skill-injection'

describe('injectNewlyActivatedSkills', () => {
  it('injects from an explicit skill activation session and records graph evidence', async () => {
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
    const records: CruxGraphRecord[] = []
    const unsubscribe = subscribeObservability((record) => records.push(record))

    try {
      await observe.span({ name: 'agent step', family: 'agent', primitive: 'agent.run' }, async () => {
        injectNewlyActivatedSkills(params, session)
      })
    } finally {
      unsubscribe()
    }

    expect((params.prompt as Array<{ content: string }>)[0]?.content).toContain('## Skill: seo')
    expect(records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'skill.injected',
        attributes: { skillId: 'seo' },
      }),
    )
    expect(session.newlyActivated()).toEqual([])
  })
})
