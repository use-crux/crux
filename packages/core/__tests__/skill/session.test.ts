import { describe, expect, it } from 'vitest'
import { createSkillActivationSession, skill } from '../../skill'
import { compilePrompt } from '../../resolver/compile'

describe('SkillActivationSession', () => {
  it('keeps injected-skill tracking isolated per activation session', () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })
    const first = createSkillActivationSession({ skills: [seo] })
    const second = createSkillActivationSession({ skills: [seo] })

    first.activate('seo')
    first.markInjected(['seo'])
    second.activate('seo')

    expect(first.newlyActivated()).toEqual([])
    expect(second.newlyActivated()).toEqual([seo])
  })

  it('activates skills and exposes session-owned context, injection, and snapshot state', () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })
    const session = createSkillActivationSession({ skills: [seo] })

    expect(session.activeIds()).toEqual([])

    const result = session.activate('seo')

    expect(result.status).toBe('activated')
    expect(session.activeIds()).toEqual(['seo'])
    expect(session.loadedContexts().map((ctx) => ctx.systemFn({}))).toEqual([
      '## Skill: seo\n\nUse search intent before drafting.',
    ])
    expect(session.newlyActivated()).toEqual([seo])

    session.markInjected()

    expect(session.newlyActivated()).toEqual([])
    expect(session.snapshot()).toEqual({
      activeSkillIds: ['seo'],
      injectedSkillIds: ['seo'],
    })
  })

  it('resolves input with active skill ids for the next prompt resolution', () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })
    const session = createSkillActivationSession({ skills: [seo] })

    expect(session.resolveInput({ topic: 'pricing' })).toEqual({ topic: 'pricing' })

    session.activate('seo')

    expect(session.resolveInput({ topic: 'pricing' })).toEqual({
      topic: 'pricing',
      _crux_activeSkills: ['seo'],
    })
  })

  it('loads persisted snapshots with createSkillActivationSession.forTarget', async () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })

    const session = await createSkillActivationSession.forTarget({
      skills: [seo],
      target: { threadId: 'thread-1' },
      persistence: {
        load: async () => ({ activeSkillIds: ['seo'], injectedSkillIds: ['seo'] }),
        save: async () => undefined,
      },
    })

    expect(session.activeIds()).toEqual(['seo'])
    expect(session.loadedContexts().map((ctx) => ctx.systemFn({}))).toEqual([
      '## Skill: seo\n\nUse search intent before drafting.',
    ])
    expect(session.newlyActivated()).toEqual([])
  })

  it('attaches an explicit session handle to resolved prompts that include skills', async () => {
    const seo = skill.inline({
      id: 'seo',
      description: 'SEO writing',
      instructions: 'Use search intent before drafting.',
    })

    const resolution = await compilePrompt({ system: 'Draft.', use: [seo] }).resolve({})

    expect((resolution.args as { _skillSession?: unknown })._skillSession).toBeDefined()
  })
})
