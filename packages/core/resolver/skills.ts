/**
 * The skill resolution surface — the cross-entry collector for skills.
 *
 * Skills are the one entry family whose contribution is collective rather
 * than per-entry: all skills in a prompt produce ONE index context (placed
 * before every other contribution), one pair of loader tools
 * (`LoadSkill`/`LoadReference`), and a shared activation state. This module
 * computes that surface once, for both `resolvePrompt` and `inspectArgs` —
 * previously two hand-synchronized ~90-line blocks that had already drifted
 * (different lazy-skill detection, different fetch-failure handling).
 *
 * Unified behavior (the stricter `resolvePrompt` variant won):
 * - lazy registry skills are detected by their placeholder description OR
 *   placeholder instructions;
 * - a failed registry fetch degrades to the placeholder skill and reports
 *   through the diagnostics port.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyToolSet, Context, SkillEntry } from '../types'
import { generateIndex } from '../skill/project-index'
import {
  LOAD_SKILL_TOOL_NAME,
  LOAD_REFERENCE_TOOL_NAME,
  createSkillState,
  createLoadSkillTool,
  createLoadReferenceTool,
  type SkillActivationState,
} from '../skill/tools'
import type { ResolverPorts } from './ports'

/** Read activated skill identifiers passed in via the `_crux_activeSkills` input field. */
export function readActiveSkillIds(input: unknown): readonly string[] {
  if (!input || typeof input !== 'object') return []
  const value = (input as Record<string, unknown>)._crux_activeSkills
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

/** Build one of the pipeline's internal static contexts (skill index, loaded skills). */
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
    constraints: Object.freeze([]),
    guardrails: Object.freeze([]),
    when: undefined,
    cacheTtl: 0,
    providerCache: false,
  })
}

/**
 * The collective contribution of a prompt's skills, ready for placement.
 *
 * `indexContext` leads the active context list (priority 90); each entry of
 * `loadedContexts` carries the full instructions of a previously activated
 * skill (priority 85). `skills` is the post-fetch list — lazy registry
 * entries replaced by their resolved content where the fetch succeeded.
 */
export interface SkillSurface {
  skills: SkillEntry[]
  indexContext: Context<z.ZodType>
  loadedContexts: Context<z.ZodType>[]
}

/**
 * Resolve a prompt's skill entries into their collective surface.
 *
 * Runs once per resolution, after entry resolution collected the skill
 * entries and before system composition:
 *
 * 1. Lazy registry skills (placeholder content) are fetched through the
 *    skill source port; failures degrade to the placeholder with a
 *    `diagnostics.warn` — resolution never fails because a registry is down.
 * 2. The skill index context is generated from the resolved skills.
 * 3. Previously activated skills (same-process activation state, plus
 *    cross-process ids passed via `input._crux_activeSkills`) get their full
 *    instructions injected as loaded-skill contexts.
 */
export async function resolveSkillSurface(
  skills: readonly SkillEntry[],
  input: unknown,
  ports: ResolverPorts,
): Promise<SkillSurface> {
  const resolvedSkills: SkillEntry[] = []
  for (const s of skills) {
    const isLazy =
      s.description.startsWith('Skill from registry:') ||
      (typeof s.instructions === 'string' && s.instructions.startsWith('[Skill "'))
    if (!isLazy) {
      resolvedSkills.push(s)
      continue
    }
    try {
      const fetched = await ports.skills.resolveRegistrySkill(s.id)
      resolvedSkills.push(
        Object.freeze({
          _tag: 'Skill' as const,
          id: fetched.meta.name,
          description: fetched.meta.description,
          instructions: fetched.instructions,
          references: fetched.references,
          meta: fetched.meta,
          dump: () => fetched.instructions,
        }),
      )
    } catch (err) {
      ports.diagnostics.warn(`[@crux/core] Failed to fetch skill "${s.id}":`, err instanceof Error ? err.message : err)
      resolvedSkills.push(s)
    }
  }

  const indexText = generateIndex(resolvedSkills)
  const indexContext = staticSkillContext({
    id: '__crux_skill_index',
    description: 'Auto-generated skill index',
    text: () => indexText,
    priority: 90,
  })

  const loadedContexts: Context<z.ZodType>[] = []
  const existingState = ports.skills.latestActivationState()
  const inputActiveSkills = readActiveSkillIds(input)
  const allActiveSkillIds = new Set<string>([...(existingState?.active ?? []), ...inputActiveSkills])
  for (const skillId of allActiveSkillIds) {
    const loadedSkill = resolvedSkills.find((sk) => sk.id === skillId) ?? existingState?.available.get(skillId)
    if (!loadedSkill) continue
    loadedContexts.push(
      staticSkillContext({
        id: `__crux_skill_loaded:${skillId}`,
        description: `Loaded skill: ${skillId}`,
        text: () => `## Skill: ${loadedSkill.id}\n\n${loadedSkill.instructions}`,
        priority: 85,
      }),
    )
  }

  return { skills: resolvedSkills, indexContext, loadedContexts }
}

/**
 * Create the loader toolset and activation state for a resolved prompt.
 *
 * Carries previously activated skill ids forward from the latest registered
 * state (same-process tool loops) and from `input._crux_activeSkills`
 * (serverless environments where module state is lost between steps), then
 * registers the new state through the skill source port so middleware can
 * detect activations.
 *
 * Only `resolvePrompt` calls this — `inspectArgs` reports the loader tool
 * names without instantiating tools or registering state.
 */
export function createSkillToolSurface(
  skills: readonly SkillEntry[],
  input: unknown,
  ports: ResolverPorts,
): { tools: AnyToolSet; state: SkillActivationState } {
  const state = createSkillState(skills)

  const previousState = ports.skills.latestActivationState()
  if (previousState) {
    for (const activeId of previousState.active) {
      state.active.add(activeId)
    }
  }
  for (const id of readActiveSkillIds(input)) {
    state.active.add(id)
  }

  const tools: AnyToolSet = {
    [LOAD_SKILL_TOOL_NAME]: createLoadSkillTool(state),
    [LOAD_REFERENCE_TOOL_NAME]: createLoadReferenceTool(state),
  }
  ports.skills.registerActivationState(state)
  return { tools, state }
}
