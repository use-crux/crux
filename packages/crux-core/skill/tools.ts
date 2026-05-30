/**
 * Skill tools — LoadSkill and LoadReference tool definitions.
 *
 * LoadSkill is a "system tool" — intercepted by the executor for re-resolution.
 * LoadReference is a normal tool — returns content as a tool result.
 */

import { z } from 'zod'
import type { Skill } from './types'
import { getLatestSkillState } from './state'

/** Marker used by executors to identify LoadSkill as a system tool. */
export const LOAD_SKILL_TOOL_NAME = '__crux_LoadSkill' as const
export const LOAD_REFERENCE_TOOL_NAME = '__crux_LoadReference' as const

/** Shared state tracking which skills are active (loaded via LoadSkill). */
export interface SkillActivationState {
  /** Map of skill ID -> Skill for all available skills. */
  readonly available: ReadonlyMap<string, Skill>
  /** Set of skill IDs that have been loaded via LoadSkill. */
  readonly active: Set<string>
}

/** Create a fresh skill activation state from a list of skills. */
export function createSkillState(skills: readonly Skill[]): SkillActivationState {
  const available = new Map<string, Skill>()
  for (const skill of skills) {
    available.set(skill.id, skill)
  }
  return {
    available,
    active: new Set(),
  }
}

/**
 * Create the LoadSkill tool definition.
 * The execute function marks the skill as active — the executor intercepts this
 * tool call and triggers re-resolution instead of returning the result to the model.
 */
export function createLoadSkillTool(state: SkillActivationState) {
  return {
    description:
      "Load a skill's full instructions into your context. Use this to access specialized knowledge and procedures before beginning work.",
    parameters: z.object({
      name: z.string().describe('The name/ID of the skill to load'),
    }),
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const name = args.name as string

      // Always use the latest registered state, not the one captured at tool creation.
      // This is critical for the Convex Agent path where tools are created once (pre-resolve)
      // but the state registry is updated on every contextHandler resolve.
      const currentState = getLatestSkillState() ?? state
      const skill = currentState.available.get(name)
      if (!skill) {
        const available = [...currentState.available.keys()].join(', ')
        return `Error: Skill "${name}" not found. Available skills: ${available}`
      }
      // Mark as active on the current state — next resolve will pick this up
      currentState.active.add(name)
      return `Skill "${name}" loaded successfully. Instructions are now available in your context.`
    },
  }
}

/**
 * Create the LoadReference tool definition.
 * This is a normal tool — returns reference content as a tool result.
 */
export function createLoadReferenceTool(state: SkillActivationState) {
  return {
    description:
      "Load supporting reference material for a loaded skill. Use this to access detailed knowledge that supplements a skill's main instructions.",
    parameters: z.object({
      skillName: z.string().describe('The name/ID of the skill'),
      referenceName: z.string().describe('The name of the reference to load'),
    }),
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const skillName = args.skillName as string
      const refName = args.referenceName as string
      const currentState = getLatestSkillState() ?? state
      const skill = currentState.available.get(skillName)

      if (!skill) {
        return `Error: Skill "${skillName}" not found.`
      }

      const ref = skill.references.find((r) => r.name === refName)
      if (!ref) {
        if (skill.references.length === 0) {
          return `Error: Skill "${skillName}" has no references.`
        }
        const available = skill.references.map((r) => r.name).join(', ')
        return `Error: Reference "${refName}" not found for skill "${skillName}". Available references: ${available}`
      }

      return ref.content
    },
  }
}
