/**
 * The skill resolution surface — the cross-entry collector for skills.
 *
 * Skills are the one entry family whose contribution is collective rather
 * than per-entry: all skills in a prompt produce ONE index context (placed
 * before every other contribution), one pair of loader tools
 * (`LoadSkill`/`LoadReference`), and a shared activation session. This module
 * computes that surface once inside the compiled prompt pass, then both
 * resolved args and inspection are projected from the same intermediate state.
 *
 * Unified behavior:
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
import { createSkillActivationSession, type SkillActivationSession } from '../skill/session'
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
    family: 'skill' as const,
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
 * 3. Previously activated skills passed through
 *    `input._crux_activeSkills` get their full instructions injected as
 *    loaded-skill contexts.
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

  const inputActiveSkills = readActiveSkillIds(input)
  const session = createSkillActivationSession({
    skills: resolvedSkills,
    initial: { activeSkillIds: inputActiveSkills },
  })
  const loadedContexts = [...session.loadedContexts()]

  return { skills: resolvedSkills, indexContext, loadedContexts }
}

/**
 * Create the loader toolset and activation session for a resolved prompt.
 *
 * Carries previously activated skill ids forward only from explicit
 * `input._crux_activeSkills`. Adapter loops that re-resolve after `LoadSkill`
 * pass the active session ids into input via `session.resolveInput()`.
 *
 * Only the resolve projection calls this. The inspect projection reports the
 * loader tool names without instantiating tools or registering state.
 */
export function createSkillToolSurface(
  skills: readonly SkillEntry[],
  input: unknown,
): { tools: AnyToolSet; session: SkillActivationSession } {
  const session = createSkillActivationSession({
    skills,
    initial: { activeSkillIds: readActiveSkillIds(input) },
  })
  return { tools: session.tools(), session }
}
