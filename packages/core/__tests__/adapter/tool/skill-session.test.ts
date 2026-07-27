import { describe, expect, it, vi } from 'vitest'
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

  it('re-evaluates only new or provider-visibly changed tool definitions', async () => {
    const extension = skill.inline({
      id: 'tool-extension',
      description: 'Adds tools',
      instructions: 'Use the added tools.',
    })
    const session = createSkillActivationSession({ skills: [extension] })
    session.activate('tool-extension')
    const resolved = resolvedWith({
      system: 'base',
      tools: {
        stable: {
          description: 'stable v1',
          execute: async () => 'stable-old',
        },
        changed: { description: 'changed v1' },
      },
    })
    ;(resolved as ResolvedPrompt & { _skillSession?: typeof session })._skillSession =
      session
    const reResolved = resolvedWith({
      system: 'base plus skill',
      tools: {
        stable: {
          description: 'stable v1',
          execute: async () => 'stable-new',
        },
        changed: { description: 'changed v2' },
        added: { description: 'added v1' },
      },
    })
    ;(
      reResolved as ResolvedPrompt & { _skillSession?: typeof session }
    )._skillSession = session
    const roots = vi.fn(async (subject: { name: string; description: string }) => {
      return { action: 'allow' as const }
    })
    const descriptions = vi.fn(async () => ({ action: 'allow' as const }))
    const lifecycle = createToolLifecycle({
      regime: 'core',
      resolved,
      promptId: 'skill-tool-exposure',
      reresolve: async () => reResolved,
    })

    await lifecycle.guardExposure({ root: roots, descriptions })
    await lifecycle.applySkillLoads([
      { name: LOAD_SKILL_TOOL_NAME, args: { name: 'tool-extension' } },
    ])

    expect(
      roots.mock.calls.map(([subject]) => `${subject.name}:${subject.description}`),
    ).toEqual([
      'stable:stable v1',
      'changed:changed v1',
      'changed:changed v2',
      'added:added v1',
    ])
    expect(descriptions).toHaveBeenCalledTimes(4)
    const stable = lifecycle.descriptors?.find(
      (descriptor) => descriptor.name === 'stable',
    )
    await expect(stable?.execute({}, {})).resolves.toBe('stable-new')
  })
})
