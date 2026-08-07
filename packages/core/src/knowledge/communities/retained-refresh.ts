/**
 * Retained-work backed community refresh scheduling.
 *
 * @module
 */

import { tryScheduleDiagnosticsOnlyDeferredCallback } from '../../defer/internal/port'
import type { AssetStore, JsonObject, RecordStore } from '../../storage'
import { knowledgeCurrentKey } from '../keys'
import type { ViewRevision } from '../view/revision'
import { buildCommunities, type BuildCommunitiesInput } from './build'
import type { CommunitiesConfig } from './communities'
import type { CommunityBuildDescriptor, CommunityRefreshHost } from './lifecycle'
import { createCommunityStore, type CommunityGenerationRetention } from './store'

export interface RetainedCommunityRefreshHost extends CommunityRefreshHost {
  /** Register retained background refresh; registration failures are a no-op fallback. */
  schedule(descriptor: CommunityBuildDescriptor): void
  /** Return whether this process has retained work scheduled or running for the descriptor. */
  hasPending(descriptor: CommunityBuildDescriptor): boolean
}

export interface RetainedCommunityRefreshHostInput {
  readonly records: RecordStore
  readonly assets?: AssetStore
  readonly config: CommunitiesConfig
  readonly retention?: CommunityGenerationRetention
  readonly resolveView?: () => Promise<ViewRevision>
}

/** Create the internal retained-work host used by connected knowledge communities. */
export function createRetainedCommunityRefreshHost(
  input: RetainedCommunityRefreshHostInput,
): RetainedCommunityRefreshHost {
  const pending = new Map<string, Promise<void>>()

  async function ensure(
    descriptor: CommunityBuildDescriptor,
    options: { readonly force?: boolean } = {},
  ): Promise<void> {
    if (!options.force) {
      const existing = pending.get(keyOf(descriptor))
      if (existing) return existing
    }
    return buildIfStale(input, descriptor, options)
  }

  function schedule(descriptor: CommunityBuildDescriptor): void {
    const key = keyOf(descriptor)
    if (pending.has(key)) return

    try {
      const scheduled = tryScheduleDiagnosticsOnlyDeferredCallback(() =>
        buildIfStale(input, descriptor),
      )
      if (!scheduled || scheduled.status === 'captured') return
      const promise = scheduled.settled.finally(() => {
        if (pending.get(key) === promise) pending.delete(key)
      })
      promise.catch(() => {})
      pending.set(key, promise)
    } catch {
      pending.delete(key)
    }
  }

  function hasPending(descriptor: CommunityBuildDescriptor): boolean {
    return pending.has(keyOf(descriptor))
  }

  return Object.freeze({ ensure, schedule, hasPending })
}

async function buildIfStale(
  input: RetainedCommunityRefreshHostInput,
  descriptor: CommunityBuildDescriptor,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  const build = await buildInput(input, descriptor)
  if (!options.force && await isFresh(build)) return
  await buildCommunities(build)
}

async function buildInput(
  input: RetainedCommunityRefreshHostInput,
  descriptor: CommunityBuildDescriptor,
): Promise<BuildCommunitiesInput> {
  const view = await input.resolveView?.()
  return {
    records: input.records,
    indexerId: descriptor.indexerId,
    namespace: descriptor.namespace,
    config: input.config,
    scopeKey: descriptor.scopeKey,
    ...(input.assets ? { assets: input.assets } : {}),
    ...(view ? { view } : {}),
    ...(input.retention ? { retention: input.retention } : {}),
  }
}

async function isFresh(input: BuildCommunitiesInput): Promise<boolean> {
  const store = createCommunityStore(input)
  const pointer = await store.currentGeneration()
  if (!pointer) return false
  const dirty = await store.readDirty()
  if (dirty.length > 0) return false
  return pointer.graphGeneration === await currentGraphGeneration(input.records, input.indexerId, input.namespace) &&
    pointer.viewRevision === (input.view?.revisionHash ?? null) &&
    pointer.strategyFingerprint === input.config.strategyFingerprint
}

async function currentGraphGeneration(records: RecordStore, indexerId: string, namespace: string): Promise<string> {
  const value = await records.get(knowledgeCurrentKey(indexerId, namespace))
  return isRecord(value) && value.namespace === namespace && typeof value.generationId === 'string'
    ? value.generationId
    : 'missing'
}

function keyOf(descriptor: CommunityBuildDescriptor): string {
  return `${descriptor.indexerId}\0${descriptor.namespace}\0${descriptor.scopeKey}`
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
