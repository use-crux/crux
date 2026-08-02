/**
 * Lazy assertion set read surface.
 *
 * @module
 */

import type { z } from 'zod'
import type { JsonObject, RecordStore } from '../../storage'
import { contextWithFamily } from '../../prompt/context'
import type { Context } from '../../prompt/context-types'
import type { InternalPromptInjection } from '../../prompt/internal-injection'
import { knowledgeCurrentKey, knowledgeAssertionsItemPrefix, knowledgeAssertionsRelationPrefix } from '../keys'
import type { ViewRevision } from '../view/revision'
import type { AssertionOf, AssertionStage } from './assertions'
import {
  normalizeAssertionContextOptions,
  renderAssertionSetContext,
  type AssertionContextOptions,
} from './context'
import type { AssertionSupport, KnowledgeAssertionRecord } from './identity'
import { isAssertionRelationRecord, type AssertionRelationRecord, type AssertionRelationType } from './relations'
import { createAssertionResolution, type AssertionResolutionHandle, type AssertionResolutionPolicy } from './resolution'

/** Options for listing assertion sets. */
export interface AssertionListOptions {
  readonly limit?: number
  readonly cursor?: string
}

/** One page of assertion set items. */
export interface AssertionListPage<TItem> {
  readonly items: readonly TItem[]
  readonly cursor?: string
}

/** Options for listing persisted assertion relations. */
export interface AssertionRelationListOptions {
  readonly types?: readonly AssertionRelationType[]
  readonly limit?: number
  readonly cursor?: string
}

/** Options for selecting assertion types from a stage. */
export interface AssertionSetOptions<
  TTypes extends Record<string, z.ZodType<unknown>>,
  TSelected extends keyof TTypes & string = keyof TTypes & string,
> {
  readonly types?: readonly TSelected[]
}

/** Lazy assertion read surface for a knowledge base or view. */
export interface AssertionSet<
  TTypes extends Record<string, z.ZodType<unknown>>,
  TSelected extends keyof TTypes & string = keyof TTypes & string,
> {
  readonly _tag: 'AssertionSet'
  readonly id: string
  readonly namespace: string
  /** List persisted assertions with cursor pagination. */
  list(options?: AssertionListOptions): Promise<AssertionListPage<AssertionOf<TTypes, TSelected>>>
  /** Stream persisted assertions in key order. */
  stream(): AsyncIterable<AssertionOf<TTypes, TSelected>>
  /** Resolve assertion conflicts and supersession without mutating source assertions. */
  resolve(policy?: AssertionResolutionPolicy<TTypes, TSelected>): AssertionResolutionHandle<TTypes, TSelected>
  /** List visible persisted assertion relations with cursor pagination. */
  relations(options?: AssertionRelationListOptions): Promise<AssertionListPage<AssertionRelationRecord>>
  /** Render this assertion set as bounded prompt context. */
  asContext(options?: AssertionContextOptions): Context<z.ZodType<{}>>
  /** Contribute this assertion set as context when used directly in `use`. */
  inject(args: { input: Record<string, unknown>; promptId?: string }): Promise<InternalPromptInjection>
}

interface AssertionSetFactoryConfig<TTypes extends Record<string, z.ZodType<unknown>>, TSelected extends keyof TTypes & string> {
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: AssertionStage<TTypes>
  readonly selectedTypes?: readonly TSelected[]
  readonly resolveRevision?: () => Promise<ViewRevision>
}

/**
 * Create a lazy assertion set over persisted assertion records. Internal.
 *
 * @example
 * ```ts
 * const set = createAssertionSet({ records, indexerId: "docs", namespace: "docs", stage })
 * for await (const assertion of set.stream()) console.log(assertion.type)
 * ```
 */
export function createAssertionSet<
  const TTypes extends Record<string, z.ZodType<unknown>>,
  const TSelected extends keyof TTypes & string = keyof TTypes & string,
>(config: AssertionSetFactoryConfig<TTypes, TSelected>): AssertionSet<TTypes, TSelected> {
  const selected = config.selectedTypes ? new Set<string>(config.selectedTypes) : undefined

  async function list(options: AssertionListOptions = {}): Promise<AssertionListPage<AssertionOf<TTypes, TSelected>>> {
    if (!config.records) throw new Error('knowledgeBase().assertions() requires record storage.')
    const snapshot = await readAssertionSnapshot(config)
    return listFromSnapshot(snapshot, options)
  }

  async function listFromSnapshot(
    snapshot: Awaited<ReturnType<typeof readAssertionSnapshot<TTypes>>>,
    options: AssertionListOptions = {},
  ): Promise<AssertionListPage<AssertionOf<TTypes, TSelected>>> {
    if (!config.records) throw new Error('knowledgeBase().assertions() requires record storage.')
    const members = snapshot.revision ? new Set(snapshot.revision.members.map((member) => member.sourceId)) : undefined
    return listVisiblePage(config.records, snapshot.itemPrefix, options, (value) => {
      const record = asAssertionRecord(value)
      if (!record || (selected && !selected.has(record.type))) return null
      return toVisibleAssertion<TTypes, TSelected>(record, members)
    })
  }

  async function* stream(): AsyncIterable<AssertionOf<TTypes, TSelected>> {
    let cursor: string | undefined
    while (true) {
      const page = await list({ cursor, limit: 100 })
      for (const item of page.items) yield item
      if (!page.cursor) return
      cursor = page.cursor
    }
  }

  async function relations(options: AssertionRelationListOptions = {}): Promise<AssertionListPage<AssertionRelationRecord>> {
    if (!config.records) throw new Error('knowledgeBase().assertions() requires record storage.')
    const snapshot = await readAssertionSnapshot(config)
    if (!snapshot.relationPrefix) return { items: [] }
    const members = snapshot.revision ? new Set(snapshot.revision.members.map((member) => member.sourceId)) : undefined
    const types = options.types ? new Set<string>(options.types) : undefined
    return listVisiblePage(config.records, snapshot.relationPrefix, options, (value) => {
      const relation = isAssertionRelationRecord(value) ? value : null
      if (!relation || (types && !types.has(relation.type))) return null
      return toVisibleRelation(relation, members)
    })
  }

  async function countFromSnapshot(
    snapshot: Awaited<ReturnType<typeof readAssertionSnapshot<TTypes>>>,
    cursor: string,
  ): Promise<number> {
    let total = 0
    let next: string | undefined = cursor
    do {
      const page = await listFromSnapshot(snapshot, { cursor: next, limit: 100 })
      total += page.items.length
      next = page.cursor
    } while (next)
    return total
  }

  const handle: AssertionSet<TTypes, TSelected> = {
    _tag: 'AssertionSet',
    id: config.stage.id,
    namespace: config.namespace,
    list,
    stream,
    resolve: (policy) => createAssertionResolution({ ...config, selectedTypes: config.selectedTypes, policy }),
    relations,
    asContext: (options) => {
      const normalized = normalizeAssertionContextOptions(options)
      return contextWithFamily({
        id: `assertions:${config.stage.id}`,
        description: `Assertion context for ${config.stage.id}`,
        priority: normalized.priority,
        system: async () => {
          const snapshot = await readAssertionSnapshot(config)
          const page = await listFromSnapshot(snapshot, { limit: normalized.limit + 1 })
          const items = page.items.slice(0, normalized.limit)
          const remaining = page.cursor ? await countFromSnapshot(snapshot, page.cursor) : 0
          return renderAssertionSetContext(items, {
            stageId: config.stage.id,
            generationId: snapshot.generationId,
            selectedTypes: config.selectedTypes ?? Object.keys(config.stage.types),
            ...(snapshot.revision ? { revisionHash: snapshot.revision.revisionHash } : {}),
            omitted: page.items.length - items.length + remaining,
          }, normalized)
        },
      }, 'injectable') as Context<z.ZodType<{}>>
    },
    inject: async () => ({ contexts: [handle.asContext()] }),
  }
  return Object.freeze(handle)
}

/**
 * Page through a record prefix, keeping only the items a projection admits.
 *
 * Both assertion and relation listings share the cursor arithmetic: request at
 * most the remaining page size, keep paging while the caller's limit is unmet,
 * and return the store cursor only when more records remain. Internal.
 */
async function listVisiblePage<TItem>(
  records: RecordStore,
  prefix: string,
  options: { readonly limit?: number; readonly cursor?: string },
  project: (value: JsonObject) => TItem | null,
): Promise<AssertionListPage<TItem>> {
  const items: TItem[] = []
  let cursor = options.cursor
  const limit = Math.max(0, Math.floor(options.limit ?? 100))
  while (items.length < limit) {
    const page = await records.list(prefix, { cursor, limit: Math.max(1, limit - items.length) })
    for (const entry of page.entries) {
      const item = project(entry.value)
      if (item) items.push(item)
    }
    cursor = page.cursor
    if (!cursor) break
  }
  return { items, ...(cursor ? { cursor } : {}) }
}

/** Read assertion records and relations for the current generation. Internal. */
export async function readAssertionSnapshot<TTypes extends Record<string, z.ZodType<unknown>>>(config: {
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: AssertionStage<TTypes>
  readonly resolveRevision?: () => Promise<ViewRevision>
}, options: {
  readonly includeRelations?: boolean
} = {}): Promise<{
  readonly generationId: string
  readonly itemPrefix: string
  readonly relationPrefix: string
  readonly relations: readonly AssertionRelationRecord[]
  readonly revision?: ViewRevision
}> {
  if (!config.records) throw new Error('knowledgeBase().assertions() requires record storage.')
  const current = await config.records.get(knowledgeCurrentKey(config.indexerId, config.namespace))
  const generationId = current && typeof current.generationId === 'string' ? current.generationId : ''
  const itemPrefix = generationId ? knowledgeAssertionsItemPrefix(config.indexerId, config.namespace, config.stage.id, generationId) : ''
  const relationPrefix = generationId ? knowledgeAssertionsRelationPrefix(config.indexerId, config.namespace, config.stage.id, generationId) : ''
  return {
    generationId,
    itemPrefix,
    relationPrefix,
    relations: options.includeRelations && relationPrefix ? await listAssertionRelations(config.records, relationPrefix) : [],
    ...(config.resolveRevision ? { revision: await config.resolveRevision() } : {}),
  }
}

async function listAssertionRelations(
  records: RecordStore,
  relationPrefix: string,
): Promise<readonly AssertionRelationRecord[]> {
  const relations: AssertionRelationRecord[] = []
  let cursor: string | undefined
  do {
    const page = await records.list(relationPrefix, { cursor, limit: 100 })
    relations.push(...page.entries.flatMap((entry) =>
      isAssertionRelationRecord(entry.value) ? [entry.value] : [],
    ))
    cursor = page.cursor
  } while (cursor)
  return relations
}

export function toVisibleRelation(
  relation: AssertionRelationRecord,
  members: ReadonlySet<string> | undefined,
): AssertionRelationRecord | null {
  const evidence = visibleSupports(relation.evidence, members)
  if (evidence.length === 0) return null
  return { ...relation, evidence }
}

export function toVisibleAssertion<
  TTypes extends Record<string, z.ZodType<unknown>>,
  TSelected extends keyof TTypes & string,
>(
  record: KnowledgeAssertionRecord,
  members: ReadonlySet<string> | undefined,
): AssertionOf<TTypes, TSelected> | null {
  const evidence = visibleSupports(record.evidence, members)
  if (evidence.length === 0) return null
  return {
    assertionId: record.assertionId,
    type: record.type,
    data: record.data,
    evidence,
    provenance: evidence.some((support) => support.provenance === 'derived') ? 'derived' : 'exact',
  } as AssertionOf<TTypes, TSelected>
}

export function visibleSupports(
  supports: readonly AssertionSupport[],
  members: ReadonlySet<string> | undefined,
): readonly AssertionSupport[] {
  return members ? supports.filter((support) => members.has(support.sourceId)) : supports
}

function asAssertionRecord(value: JsonObject | null): KnowledgeAssertionRecord | null {
  if (!value || value._cruxRecordType !== 'knowledge-assertion' || typeof value.assertionId !== 'string' ||
    typeof value.type !== 'string' || !Array.isArray(value.evidence)) return null
  return value as unknown as KnowledgeAssertionRecord
}
