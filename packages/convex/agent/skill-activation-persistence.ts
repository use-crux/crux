/**
 * Convex persistence adapter for Crux skill activation sessions.
 *
 * This is the one Convex-specific skill API: normal skill authoring and
 * session primitives are identical re-exports from `@use-crux/core/skill`, while
 * this adapter binds snapshots to the active Convex Crux store.
 *
 * @module
 */

import type { SkillActivationPersistence, SkillActivationSnapshot, SkillActivationTarget } from '@use-crux/core/skill'
import { getConvexCruxRuntime, type ConvexRuntimeTarget } from '../runtime'

export type ConvexSkillActivationTarget = SkillActivationTarget & {
  readonly threadId?: string
  readonly userId?: string
}

/** Create a Convex-backed persistence port for skill activation sessions. */
export function convexSkillActivationPersistence(): SkillActivationPersistence<ConvexSkillActivationTarget> {
  return {
    async load(target) {
      const runtime = getConvexCruxRuntime()
      const key = skillStateKey(target, runtime?.target)
      if (!runtime || !key) return null
      const value = await runtime.store.get(key)
      return readSkillActivationSnapshot(value)
    },
    async save(target, snapshot) {
      const runtime = getConvexCruxRuntime()
      const key = skillStateKey(target, runtime?.target)
      if (!runtime || !key) return
      await runtime.store.set(key, {
        activeSkillIds: [...snapshot.activeSkillIds],
        injectedSkillIds: [...(snapshot.injectedSkillIds ?? [])],
        updatedAt: Date.now(),
      })
    },
  }
}

function readSkillActivationSnapshot(value: unknown): SkillActivationSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { activeSkillIds?: unknown; injectedSkillIds?: unknown }
  const activeSkillIds = Array.isArray(record.activeSkillIds)
    ? record.activeSkillIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
  const injectedSkillIds = Array.isArray(record.injectedSkillIds)
    ? record.injectedSkillIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : undefined
  return {
    activeSkillIds,
    ...(injectedSkillIds ? { injectedSkillIds } : {}),
  }
}

function skillStateKey(
  target: ConvexSkillActivationTarget | undefined,
  runtimeTarget?: ConvexRuntimeTarget,
): string | undefined {
  const threadId = target?.threadId ?? runtimeTarget?.threadId
  if (threadId) return `convex-agent:${threadId}:skills`
  const userId = target?.userId ?? runtimeTarget?.userId
  if (typeof userId === 'string' && userId.length > 0) return `convex-agent:user:${userId}:skills`
  return undefined
}
