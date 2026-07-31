import { prompt as definePrompt } from '@use-crux/core'
import type { ContextEntry, ResolveOptions } from '@use-crux/core'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import type { z } from 'zod'
import { readPersistedSkillIds } from './lifecycle-persistence'
import type { AnyConvexPrompt, AnyConvexPromptConfig } from './lifecycle-types'

export function normalizeStorage(value: Storage | RecordStore): Storage {
  return 'records' in value ? value : { records: value }
}

export async function inputWithPersistedSkills(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const activeSkillIds = await readPersistedSkillIds()
  if (activeSkillIds.length === 0) return input
  return {
    ...input,
    _crux_activeSkills: activeSkillIds,
  }
}

export function promptWithRuntimeUse<TPrompt extends AnyConvexPrompt>(
  basePrompt: TPrompt,
  runtimeUse: readonly ContextEntry[] | undefined,
): AnyConvexPrompt {
  if (!runtimeUse || runtimeUse.length === 0) return basePrompt
  const baseConfig = basePrompt.config as AnyConvexPromptConfig
  return definePrompt({
    ...baseConfig,
    use: [...basePrompt.contexts, ...runtimeUse],
  })
}

export async function resolvePreparedPrompt(
  activePrompt: AnyConvexPrompt,
  input: Record<string, unknown>,
) {
  return await activePrompt.resolve({
    input,
  } as unknown as ResolveOptions<z.ZodType, readonly ContextEntry[]>)
}
