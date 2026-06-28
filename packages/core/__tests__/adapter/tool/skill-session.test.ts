import { describe, expect, it } from 'vitest'
import { createToolLifecycle } from '../../../adapter/tool/session'
import { LOAD_SKILL_TOOL_NAME } from '../../../skill/tools'
import { createSkillActivationSession, skill } from '../../../skill'
import type { ResolvedPrompt } from '../../../resolver/types'

function resolvedWith(partial: Partial<ResolvedPrompt>): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt
}

describe('createToolLifecycle — skill activation session', () => {
  it('uses the explicit skill session handle to amend prompts and mark injected skills', async () => {
    const sql = skill.inline({
      id: 'sql',
      description: 'SQL safety',
      instructions: 'Always use parameterized queries.',
    })
    const session = createSkillActivationSession({ skills: [sql] })
    session.activate('sql')

    const resolved = resolvedWith({
      system: 'base system',
      tools: { echo: { description: 'v1', execute: async () => 'one' } },
    })
    ;(resolved as ResolvedPrompt & { _skillSession?: typeof session })._skillSession = session

    const loadedSkillText = session.loadedContexts()[0]?.systemFn({})
    const reResolved = resolvedWith({
      system: `rebuilt system\n\n${loadedSkillText}`,
      tools: { echo: { description: 'v2', execute: async () => 'two' } },
    })
    ;(reResolved as ResolvedPrompt & { _skillSession?: typeof session })._skillSession = session

    const lifecycle = createToolLifecycle({
      regime: 'core',
      resolved,
      promptId: 'p1',
      reresolve: async () => reResolved,
    })

    const amendment = await lifecycle.applySkillLoads([{ name: LOAD_SKILL_TOOL_NAME, args: { name: 'sql' } }])

    expect(amendment?.system).toContain('## Skill: sql')
    expect(lifecycle.descriptors?.find((entry) => entry.name === 'echo')?.description).toBe('v2')
    expect(session.newlyActivated()).toEqual([])
    expect(session.snapshot()).toEqual({
      activeSkillIds: ['sql'],
      injectedSkillIds: ['sql'],
    })
  })
})
