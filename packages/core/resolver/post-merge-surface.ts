/**
 * Post-merge surface for a prompt-resolution pass.
 *
 * Entry resolution first produces a family-neutral `MergedResolution`. This
 * module performs the collective post-processing that must happen exactly once
 * before prompt args and inspect data are projected, most notably skill index
 * and activated-skill context construction.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyToolSet, BlackboardEntry, Context, MemoryEntry, SkillEntry } from '../types'
import type { ExcludedContext } from './types'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { MergedResolution } from './contract'
import type { ResolverPorts } from './ports'
import { resolveSkillSurface } from './skills'

/** Runtime surface ready for system composition and prompt arg projection. */
export interface PostMergeSurface {
  readonly contexts: Context<z.ZodType>[]
  readonly excluded: ExcludedContext[]
  readonly skills: SkillEntry[]
  readonly memories: MemoryEntry[]
  readonly blackboards: BlackboardEntry[]
  readonly injectedTools: AnyToolSet
  readonly injectedConstraints: Constraint[]
  readonly injectedGuardrails: Guardrail[]
  readonly injectedMetadata: Record<string, unknown>
}

/** Resolve collective families and return the final surface for a pass. */
export async function resolvePostMergeSurface(
  merged: MergedResolution,
  input: Record<string, unknown>,
  ports: ResolverPorts,
): Promise<PostMergeSurface> {
  const contexts = [...merged.active]
  let skills = [...merged.skills]

  if (skills.length > 0) {
    const surface = await resolveSkillSurface(skills, input, ports)
    skills = surface.skills
    contexts.unshift(surface.indexContext)
    contexts.push(...surface.loadedContexts)
  }

  return {
    contexts,
    excluded: merged.excluded,
    skills,
    memories: merged.memories,
    blackboards: merged.blackboards,
    injectedTools: merged.tools,
    injectedConstraints: merged.constraints,
    injectedGuardrails: merged.guardrails,
    injectedMetadata: merged.metadata,
  }
}
