/**
 * Agent skill kit — handles all wiring for skills in agent frameworks
 * that manage their own tool loop (Convex Agent, Mastra, etc.).
 *
 * Provides:
 * - Pre-extracted `LoadSkill` / `LoadReference` tools with persistence wired in.
 * - Input enhancement that injects `_crux_activeSkills` for `resolve()`.
 * - Cross-turn skill activation state through `SkillActivationSnapshot`.
 *
 * @example
 * ```ts
 * import { createAgentSkillKit } from '@use-crux/core/skill'
 *
 * const kit = await createAgentSkillKit(myPrompt, {
 *   target: { threadId: 'thread-1' },
 *   persistence: mySkillActivationPersistence,
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

import type {
  SkillActivationPersistence,
  SkillActivationSession,
  SkillActivationSnapshot,
  SkillActivationTarget,
} from './session'

/**
 * Session-backed persistence options for external agent frameworks.
 *
 * The port stores the same snapshot that
 * {@link SkillActivationSession.snapshot} returns, so active and injected
 * ids travel together across serverless or framework-managed tool-loop turns.
 */
export interface AgentSkillKitOptions<TTarget extends SkillActivationTarget = SkillActivationTarget> {
  /** Stable persistence key for the current thread, user, or framework scope. */
  readonly target: TTarget
  /** Snapshot storage port. */
  readonly persistence: SkillActivationPersistence<TTarget>
  /** Optional input used for the initial pre-resolve that extracts skill tools. */
  readonly resolveInput?: Record<string, unknown>
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

interface SkillPromptResolveResult {
  readonly tools?: Record<string, unknown>
  readonly _skillSession?: SkillActivationSession
}

interface SkillPrompt {
  resolve(opts: Record<string, unknown>): Promise<SkillPromptResolveResult>
}

function snapshotActiveIds(snapshot: SkillActivationSnapshot | null): readonly string[] {
  if (!snapshot) return []
  return snapshot.activeSkillIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function inputWithActiveSkills(
  baseInput: Record<string, unknown>,
  activeSkillIds: readonly string[],
): Record<string, unknown> {
  if (activeSkillIds.length === 0) return baseInput
  return { ...baseInput, _crux_activeSkills: activeSkillIds }
}

function readSkillSession(resolved: SkillPromptResolveResult): SkillActivationSession | undefined {
  return resolved._skillSession
}

/**
 * Create a skill kit for agent frameworks that manage their own tool loop.
 *
 * Pre-resolves the prompt to extract skill tools, wires in persistence
 * for cross-turn state, and provides an input enhancer for resolve calls.
 *
 * @param prompt - A Crux prompt that has skills in its `use` array
 * @param options - Snapshot persistence and target for the external agent turn
 */
export async function createAgentSkillKit<TTarget extends SkillActivationTarget = SkillActivationTarget>(
  prompt: SkillPrompt,
  options: AgentSkillKitOptions<TTarget>,
): Promise<AgentSkillKit> {
  const { target, persistence } = options
  const initialSnapshot = await persistence.load(target).catch(() => null)
  const initialActiveIds = snapshotActiveIds(initialSnapshot)
  const preResolved = await prompt.resolve({
    input: inputWithActiveSkills(options.resolveInput ?? {}, initialActiveIds),
  })
  const session = readSkillSession(preResolved)

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
            if (!result.startsWith('Error:')) {
              await saveSessionSnapshot(persistence, target, session).catch(() => undefined)
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
      const snapshot = await persistence.load(target).catch(() => null)
      const activeIds = snapshotActiveIds(snapshot)
      return inputWithActiveSkills(baseInput, activeIds)
    },

    async getActiveIds(): Promise<string[]> {
      const snapshot = await persistence.load(target).catch(() => null)
      return [...snapshotActiveIds(snapshot)]
    },
  }
}

async function saveSessionSnapshot<TTarget extends SkillActivationTarget>(
  persistence: SkillActivationPersistence<TTarget>,
  target: TTarget,
  session: SkillActivationSession | undefined,
): Promise<void> {
  if (!session) return
  await persistence.save(target, session.snapshot())
}
