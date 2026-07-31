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
import type { AnyToolSet } from '../types'
import type { BlackboardEntry, Context, MemoryEntry, SkillEntry } from '../prompt/context-types'
import type { ExcludedContext } from './types'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { ToolMiddleware } from '../tools/types'
import type { ToolSource } from '../tools/tool-source'
import type { MergedResolution } from './contract'
import type { ResolverPorts } from './ports'
import { resolveSkillSurface } from './skills'
import type { ToolOwnerLabel } from './tool-merge'
import type { RecentHistoryProjection } from '../request/history/source'
import { invalidHistoryComposition } from '../request/history/recent'

/** Runtime surface ready for system composition and prompt arg projection. */
export interface PostMergeSurface {
  readonly contexts: Context<z.ZodType>[]
  readonly excluded: ExcludedContext[]
  readonly skills: SkillEntry[]
  readonly memories: MemoryEntry[]
  readonly blackboards: BlackboardEntry[]
  readonly historyProjection: RecentHistoryProjection | undefined
  readonly injectedTools: AnyToolSet
  readonly toolSources: readonly ToolSource[]
  readonly injectedToolOwners: ReadonlyMap<string, ToolOwnerLabel>
  readonly injectedToolMiddleware: ToolMiddleware[]
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
  if (merged.history.length > 1) {
    throw invalidHistoryComposition(
      "Exactly one history projection may be active after prompt resolution. Remove the duplicate history.recent() entry.",
    )
  }
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
    historyProjection: merged.history[0],
    injectedTools: merged.tools,
    toolSources: merged.toolSources,
    injectedToolOwners: merged.toolOwners,
    injectedToolMiddleware: merged.toolMiddleware,
    injectedConstraints: merged.constraints,
    injectedGuardrails: merged.guardrails,
    injectedMetadata: merged.metadata,
  }
}
