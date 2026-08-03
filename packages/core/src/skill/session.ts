/**
 * Skill activation sessions.
 *
 * A session is the deep boundary for the skill-loading state machine. It
 * owns the available skill index, active skill ids, loaded-skill contexts,
 * loader tools, injection bookkeeping, and persistence snapshots for one
 * prompt/agent turn.
 *
 * @module
 */

import { z } from 'zod'
import type { AnyToolSet } from '../types'
import type { Context } from '../prompt/context-types'
import type { Skill } from './types'
import { LOAD_REFERENCE_TOOL_NAME, LOAD_SKILL_TOOL_NAME } from './tools'
import type {
  SkillActivationResult,
  SkillActivationSession,
  SkillActivationSessionForTargetOptions,
  SkillActivationSessionOptions,
  SkillActivationSnapshot,
  SkillActivationTarget,
  SkillReferenceResult,
} from './session-contract'
import { skillAvailabilitySelection } from './session-contract'

export type {
  SkillActivationPersistence,
  SkillActivationResult,
  SkillActivationSession,
  SkillActivationSessionForTargetOptions,
  SkillActivationSessionOptions,
  SkillActivationSnapshot,
  SkillActivationTarget,
  SkillReferenceResult,
} from './session-contract'

/**
 * Read activated skill identifiers from a resolve input's `_crux_activeSkills`
 * field. Adapter loops re-inject this field after `LoadSkill` to carry the
 * active set forward across re-resolutions; anything else returns no ids.
 */
export function readActiveSkillIds(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return []
  const value = (input as Record<string, unknown>)._crux_activeSkills
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

let sessionCounter = 0

interface CreateSkillActivationSession {
  /** Create a new in-process skill activation session. */
  (options: SkillActivationSessionOptions): SkillActivationSession
  /** Load a persisted snapshot first, then create a session for the target. */
  forTarget<TTarget extends SkillActivationTarget>(
    options: SkillActivationSessionForTargetOptions<TTarget>,
  ): Promise<SkillActivationSession>
}

class DefaultSkillActivationSession implements SkillActivationSession {
  readonly id: string

  private readonly entries: ReadonlyMap<string, Skill>
  private readonly active = new Set<string>()
  private readonly injected = new Set<string>()
  private disabled = new Set<string>()

  constructor(options: SkillActivationSessionOptions) {
    this.id = options.id ?? `skill-session-${++sessionCounter}`
    this.entries = new Map(options.skills.map((entry) => [entry.id, entry]))

    const initial = options.initial
    if (!initial) return

    for (const skillId of initial.activeSkillIds) {
      this.active.add(skillId)
    }
    const injectedSkillIds = initial.injectedSkillIds ?? initial.activeSkillIds
    for (const skillId of injectedSkillIds) {
      this.injected.add(skillId)
    }
  }

  get available(): ReadonlyMap<string, Skill> {
    return new Map(
      [...this.entries].filter(([skillId]) => !this.disabled.has(skillId)),
    )
  }

  [skillAvailabilitySelection](disabledSkillIds: readonly string[]): void {
    this.disabled = new Set(disabledSkillIds)
  }

  activeIds(): readonly string[] {
    return [...this.active].filter((skillId) => !this.disabled.has(skillId))
  }

  snapshot(): SkillActivationSnapshot {
    return {
      activeSkillIds: this.activeIds(),
      injectedSkillIds: [...this.injected].filter(
        (skillId) => this.active.has(skillId) && !this.disabled.has(skillId),
      ),
    }
  }

  resolveInput(baseInput: Record<string, unknown> = {}): Record<string, unknown> {
    const activeSkillIds = this.activeIds()
    if (activeSkillIds.length === 0) return baseInput
    return { ...baseInput, _crux_activeSkills: activeSkillIds }
  }

  activate(skillId: string): SkillActivationResult {
    const skill = this.available.get(skillId)
    if (!skill) {
      return {
        status: 'not-found',
        skillId,
        availableSkillIds: [...this.available.keys()],
        message: `Error: Skill "${skillId}" not found. Available skills: ${[...this.available.keys()].join(', ')}`,
      }
    }

    if (this.active.has(skillId)) {
      return {
        status: 'already-active',
        skill,
        message: `Skill "${skillId}" is already loaded. Instructions are already available in your context.`,
      }
    }

    this.active.add(skillId)
    return {
      status: 'activated',
      skill,
      message: `Skill "${skillId}" loaded successfully. Instructions are now available in your context.`,
    }
  }

  reference(skillId: string, referenceName: string): SkillReferenceResult {
    const skill = this.available.get(skillId)
    if (!skill) {
      return {
        status: 'skill-not-found',
        skillId,
        message: `Error: Skill "${skillId}" not found.`,
      }
    }

    const reference = skill.references.find((entry) => entry.name === referenceName)
    if (!reference) {
      if (skill.references.length === 0) {
        return {
          status: 'reference-not-found',
          skill,
          referenceName,
          availableReferenceNames: [],
          message: `Error: Skill "${skillId}" has no references.`,
        }
      }
      const availableReferenceNames = skill.references.map((entry) => entry.name)
      return {
        status: 'reference-not-found',
        skill,
        referenceName,
        availableReferenceNames,
        message: `Error: Reference "${referenceName}" not found for skill "${skillId}". Available references: ${availableReferenceNames.join(', ')}`,
      }
    }

    return {
      status: 'found',
      skill,
      referenceName,
      content: reference.content,
    }
  }

  loadedContexts(): readonly Context<z.ZodType>[] {
    return this.activeIds().flatMap((skillId) => {
      const loadedSkill = this.available.get(skillId)
      if (!loadedSkill) return []
      return [
        staticSkillContext({
          id: `__crux_skill_loaded:${skillId}`,
          description: `Loaded skill: ${skillId}`,
          text: () => `## Skill: ${loadedSkill.id}\n\n${loadedSkill.instructions}`,
          priority: 85,
        }),
      ]
    })
  }

  tools(): AnyToolSet {
    return {
      [LOAD_SKILL_TOOL_NAME]: {
        description:
          "Load a skill's full instructions into your context. Use this to access specialized knowledge and procedures before beginning work.",
        parameters: z.object({
          name: z.string().describe('The name/ID of the skill to load'),
        }),
        execute: async (args: Record<string, unknown>): Promise<string> => {
          const skillId = typeof args.name === 'string' ? args.name : ''
          return this.activate(skillId).message
        },
      },
      [LOAD_REFERENCE_TOOL_NAME]: {
        description:
          "Load supporting reference material for a loaded skill. Use this to access detailed knowledge that supplements a skill's main instructions.",
        parameters: z.object({
          skillName: z.string().describe('The name/ID of the skill'),
          referenceName: z.string().describe('The name of the reference to load'),
        }),
        execute: async (args: Record<string, unknown>): Promise<string> => {
          const skillId = typeof args.skillName === 'string' ? args.skillName : ''
          const referenceName = typeof args.referenceName === 'string' ? args.referenceName : ''
          const result = this.reference(skillId, referenceName)
          return result.status === 'found' ? result.content : result.message
        },
      },
    }
  }

  newlyActivated(): readonly Skill[] {
    return this.activeIds().flatMap((skillId) => {
      if (this.injected.has(skillId)) return []
      const skill = this.available.get(skillId)
      return skill ? [skill] : []
    })
  }

  markInjected(skillIds: readonly string[] = this.activeIds()): void {
    for (const skillId of skillIds) {
      if (!this.disabled.has(skillId)) this.injected.add(skillId)
    }
  }
}

function staticSkillContext(options: {
  id: string
  description: string
  text: () => string
  priority: number
}): Context<z.ZodType> {
  return Object.freeze({
    _tag: 'Context' as const,
    id: options.id,
    description: options.description,
    inputSchema: undefined,
    inputKeys: Object.freeze([]) as readonly string[],
    systemFn: options.text,
    useEntries: Object.freeze([]),
    priority: options.priority,
    toolsFn: undefined,
    rawFields: Object.freeze([]) as readonly string[],
    escapeFields: Object.freeze([]) as readonly string[],
    constraints: Object.freeze([]),
    guardrails: Object.freeze([]),
    when: undefined,
    memoTtl: 0,
    providerCache: false,
    definitionWarnings: Object.freeze([]),
    family: 'skill' as const,
  })
}

async function createSkillActivationSessionForTarget<TTarget extends SkillActivationTarget>(
  options: SkillActivationSessionForTargetOptions<TTarget>,
): Promise<SkillActivationSession> {
  const initial = await options.persistence.load(options.target)
  return new DefaultSkillActivationSession({
    skills: options.skills,
    id: options.id,
    initial,
  })
}

function createSkillActivationSessionBase(options: SkillActivationSessionOptions): SkillActivationSession {
  return new DefaultSkillActivationSession(options)
}

export const createSkillActivationSession: CreateSkillActivationSession = Object.assign(
  createSkillActivationSessionBase,
  {
    forTarget: createSkillActivationSessionForTarget,
  },
)
