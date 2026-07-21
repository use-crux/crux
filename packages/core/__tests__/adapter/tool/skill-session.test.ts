import { describe, expect, it } from 'vitest'
import { createToolLifecycle } from '../../../src/adapter/tool/session'
import { LOAD_SKILL_TOOL_NAME } from '../../../src/skill/tools'
import { createSkillActivationSession, skill } from '../../../src/skill'
import type { ResolvedPrompt } from '../../../src/resolver/types'
import { SafetyResultError } from '../../../src/safety/errors'

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

  it('does not mark a skill injected when its guarded amendment is terminal', async () => {
    const sql = skill.inline({
      id: 'blocked-sql',
      description: 'Blocked SQL safety',
      instructions: 'Unsafe instructions.',
    })
    const session = createSkillActivationSession({ skills: [sql] })
    session.activate('blocked-sql')
    const resolved = resolvedWith({ system: 'base system' })
    ;(resolved as ResolvedPrompt & { _skillSession?: typeof session })._skillSession = session

    const lifecycle = createToolLifecycle({
      regime: 'core',
      resolved,
      promptId: 'p-blocked',
      reresolve: async () => resolvedWith({ system: 'unsafe amendment' }),
      guardSkillAmendment: async () => {
        throw new SafetyResultError({
          message: 'blocked amendment',
          policyId: 'blocked-skill-policy',
          boundary: 'model.instructions',
          problem: 'blocked amendment',
        })
      },
    })

    await expect(
      lifecycle.applySkillLoads([
        { name: LOAD_SKILL_TOOL_NAME, args: { name: 'blocked-sql' } },
      ]),
    ).rejects.toMatchObject({ policyId: 'blocked-skill-policy' })
    expect(session.newlyActivated().map((entry) => entry.id)).toEqual([
      'blocked-sql',
    ])
    expect(session.snapshot().injectedSkillIds).toEqual([])
  })
})
