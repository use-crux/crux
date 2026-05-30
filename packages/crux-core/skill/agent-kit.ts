/**
 * Agent skill kit — handles all wiring for skills in agent frameworks
 * that manage their own tool loop (Convex Agent, Mastra, etc.).
 *
 * Provides:
 * - Pre-extracted LoadSkill/LoadReference tools with persistence wired in
 * - Input enhancement that injects _crux_activeSkills for resolve()
 * - Cross-turn skill state management via user-provided callbacks
 *
 * @example
 * ```ts
 * import { createAgentSkillKit } from '@crux/core/skill'
 *
 * const kit = await createAgentSkillKit(myPrompt, {
 *   onActivate: async (skillId) => {
 *     // Persist to your store (blackboard, DB, Redis, etc.)
 *     const ids = await db.get('activeSkills') ?? []
 *     await db.set('activeSkills', [...ids, skillId])
 *   },
 *   loadActiveIds: async () => {
 *     // Retrieve persisted skill IDs
 *     return await db.get('activeSkills') ?? []
 *   },
 * })
 *
 * // Merge skill tools with your agent's tools
 * const tools = { ...myTools, ...kit.tools }
 *
 * // In your context handler / per-turn resolve:
 * const resolved = await myPrompt.resolve({
 *   input: await kit.resolveInput(dynamicData),
 * })
 * ```
 */

import type { Skill, SkillReference } from './types'

/** Persistence callbacks for cross-turn skill state. */
export interface SkillPersistence {
  /**
   * Called when LoadSkill activates a skill.
   * Persist the skill ID to your store for cross-turn survival.
   */
  onActivate: (skillId: string) => Promise<void>

  /**
   * Called at the start of each turn to retrieve previously activated skill IDs.
   * Return the persisted IDs from your store.
   */
  loadActiveIds: () => Promise<string[]>
}

/** Tool definition compatible with any agent framework. */
export interface SkillToolDef {
  description: string
  parameters: import('zod').ZodType
  execute: (args: Record<string, unknown>) => Promise<string>
}

/** The result of createAgentSkillKit(). */
export interface AgentSkillKit {
  /**
   * LoadSkill and LoadReference tools, ready to merge into your agent's tool set.
   * LoadSkill is pre-wrapped with persistence — activations survive across turns.
   *
   * For Convex Agent: wrap each with createTool() before passing to the Agent.
   * For other frameworks: use directly or adapt to your tool format.
   */
  tools: Record<string, SkillToolDef>

  /**
   * Enhance a resolve input object with _crux_activeSkills.
   * Call this in your context handler before passing input to prompt.resolve().
   *
   * @example
   * ```ts
   * const resolved = await myPrompt.resolve({
   *   input: await kit.resolveInput(dynamicData),
   * })
   * ```
   */
  resolveInput: (baseInput: Record<string, unknown>) => Promise<Record<string, unknown>>

  /**
   * Get the currently active skill IDs (from persistence).
   */
  getActiveIds: () => Promise<string[]>
}

/**
 * Create a skill kit for agent frameworks that manage their own tool loop.
 *
 * Pre-resolves the prompt to extract skill tools, wires in persistence
 * for cross-turn state, and provides an input enhancer for resolve calls.
 *
 * @param prompt - A Crux prompt that has skills in its `use` array
 * @param persistence - Callbacks for persisting/loading active skill IDs
 * @param resolveInput - Optional input for the pre-resolve (e.g., { mode })
 */
export async function createAgentSkillKit(
  prompt: { resolve: (opts: Record<string, unknown>) => Promise<{ tools?: Record<string, unknown> }> },
  persistence: SkillPersistence,
  resolveInput?: Record<string, unknown>,
): Promise<AgentSkillKit> {
  // Pre-resolve to extract skill tools from the resolution pipeline
  const preResolved = await prompt.resolve({ input: resolveInput ?? {} })

  const tools: Record<string, SkillToolDef> = {}

  if (preResolved.tools) {
    for (const [name, tool] of Object.entries(preResolved.tools as Record<string, SkillToolDef>)) {
      if (!name.startsWith('__crux_')) continue

      if (name === '__crux_LoadSkill') {
        // Wrap LoadSkill with persistence
        const originalExecute = tool.execute
        tools[name] = {
          description: tool.description,
          parameters: tool.parameters,
          execute: async (args: Record<string, unknown>) => {
            const result = await originalExecute(args)
            // Persist activation on success
            if (result.includes('loaded successfully')) {
              const skillName = args.name as string
              try {
                await persistence.onActivate(skillName)
              } catch {
                // Non-blocking — skill still works this turn via tool result
              }
            }
            return result
          },
        }
      } else {
        // LoadReference and any future skill tools — pass through
        tools[name] = tool
      }
    }
  }

  return {
    tools,

    async resolveInput(baseInput: Record<string, unknown>): Promise<Record<string, unknown>> {
      try {
        const activeIds = await persistence.loadActiveIds()
        if (activeIds.length > 0) {
          return { ...baseInput, _crux_activeSkills: activeIds }
        }
      } catch {
        // Non-blocking — skills just won't be pre-loaded this turn
      }
      return baseInput
    },

    async getActiveIds(): Promise<string[]> {
      try {
        return await persistence.loadActiveIds()
      } catch {
        return []
      }
    },
  }
}
