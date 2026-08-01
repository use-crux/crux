/**
 * Generation ownership for connected knowledge records.
 *
 * The store coordinates generation-scoped writes and the current-generation
 * pointer while remaining portable over {@link RecordStore}.
 *
 * @module
 */

import type { JsonObject, RecordStore } from '../storage'
import {
  knowledgeCurrentKey,
  knowledgeEdgeKey,
  knowledgeEntityKey,
  knowledgeGenerationPrefix,
} from './keys'
import type { KnowledgeEdgeRecord, KnowledgeEntityRecord } from './records'

/** Retention policy applied to the replaced connected knowledge generation. */
export type KnowledgeGenerationRetention = 'cleanup' | 'retain-inactive'

/** Configuration for {@link createKnowledgeGenerationStore}. */
export interface KnowledgeGenerationStoreConfig {
  /** JSON record store that persists connected knowledge records. */
  readonly records: RecordStore
  /** Stable indexer id used by connected knowledge keys. */
  readonly indexerId: string
  /** Structural namespace used by connected knowledge keys. */
  readonly namespace: string
  /** Default retention policy for replaced generations. */
  readonly retention?: KnowledgeGenerationRetention
}

/** Options for {@link KnowledgeGenerationStore.publish}. */
export interface KnowledgeGenerationPublishOptions {
  /** Override the store retention policy for this publish. */
  readonly retention?: KnowledgeGenerationRetention
}

/** Pointer record for the active connected knowledge generation. */
export interface KnowledgeCurrentGenerationRecord extends JsonObject {
  readonly _cruxRecordType: 'knowledge-current'
  readonly generationId: string
  readonly namespace: string
  readonly updatedAt: number
}

/** Writer for one unpublished connected knowledge generation. */
export interface KnowledgeGenerationWriter {
  /** Generation id all writes are scoped to. */
  readonly generationId: string
  /** Write a pre-keyed generation record. */
  putRecord(key: string, value: JsonObject): Promise<void>
  /** Write a connected knowledge edge under its generation key. */
  putEdge(record: KnowledgeEdgeRecord): Promise<void>
  /** Write a connected knowledge entity under its generation key. */
  putEntity(record: KnowledgeEntityRecord): Promise<void>
  /** Mark this generation complete and eligible for publish. */
  finish(): Promise<void>
}

/** Connected knowledge generation ownership store. */
export interface KnowledgeGenerationStore {
  /** Return the currently published connected knowledge generation id, if any. */
  currentGeneration(): Promise<string | null>
  /**
   * Begin a connected knowledge generation and return its scoped writer.
   *
   * @example
   * ```ts
   * const writer = generations.beginGeneration('graph-001')
   * await writer.putEntity(entity)
   * await writer.finish()
   * await generations.publish('graph-001')
   * ```
   */
  beginGeneration(generationId: string): KnowledgeGenerationWriter
  /** Publish a finished generation and apply retention to the replaced one. */
  publish(generationId: string, options?: KnowledgeGenerationPublishOptions): Promise<void>
  /** Abandon an unpublished generation and remove its partial records. */
  abandon(generationId: string): Promise<void>
}

type GenerationState = 'building' | 'finished' | 'published' | 'abandoned'

/** Create a connected knowledge generation store from core storage ports. */
export function createKnowledgeGenerationStore(config: KnowledgeGenerationStoreConfig): KnowledgeGenerationStore {
  const states = new Map<string, GenerationState>()

  async function currentGeneration(): Promise<string | null> {
    return asCurrentGenerationRecord(await config.records.get(pointerKey()))?.generationId ?? null
  }

  function beginGeneration(generationId: string): KnowledgeGenerationWriter {
    assertValidGenerationId(generationId)
    const state = states.get(generationId)
    if (state === 'abandoned') throw new Error(`Knowledge generation "${generationId}" was abandoned.`)
    if (state === 'published') throw new Error(`Knowledge generation "${generationId}" was already published.`)
    if (state === 'finished') throw new Error(`Knowledge generation "${generationId}" was already finished.`)
    if (state === 'building') throw new Error(`Knowledge generation "${generationId}" was already begun.`)
    states.set(generationId, 'building')

    const prefix = generationPrefix(generationId)

    async function putRecord(key: string, value: JsonObject): Promise<void> {
      assertBuilding(states.get(generationId), generationId)
      if (!key.startsWith(prefix)) {
        throw new Error(`Knowledge generation "${generationId}" cannot write outside its generation prefix.`)
      }
      const existing = await config.records.get(key)
      if (existing) {
        if (stableJson(existing) !== stableJson(value)) {
          throw new Error(`Knowledge generation "${generationId}" cannot rewrite "${key}" with a different value.`)
        }
        return
      }
      await config.records.put(key, value)
    }

    return Object.freeze({
      generationId,
      putRecord,
      putEdge: (record: KnowledgeEdgeRecord) => {
        assertGenerationRecord(record, generationId, config.namespace)
        return putRecord(
          knowledgeEdgeKey(config.indexerId, config.namespace, generationId, record.edgeId),
          record as unknown as JsonObject,
        )
      },
      putEntity: (record: KnowledgeEntityRecord) => {
        assertGenerationRecord(record, generationId, config.namespace)
        return putRecord(
          knowledgeEntityKey(config.indexerId, config.namespace, generationId, record.entityId),
          record as unknown as JsonObject,
        )
      },
      finish: async () => {
        assertBuilding(states.get(generationId), generationId)
        states.set(generationId, 'finished')
      },
    })
  }

  async function publish(generationId: string, options: KnowledgeGenerationPublishOptions = {}): Promise<void> {
    assertPublishable(states.get(generationId), generationId)
    const previousGenerationId = await currentGeneration()
    await config.records.put(pointerKey(), {
      _cruxRecordType: 'knowledge-current',
      generationId,
      namespace: config.namespace,
      updatedAt: Date.now(),
    })
    states.set(generationId, 'published')

    const retention = options.retention ?? config.retention ?? 'cleanup'
    if (retention === 'cleanup' && previousGenerationId && previousGenerationId !== generationId) {
      await deleteGeneration(previousGenerationId)
    }
  }

  async function abandon(generationId: string): Promise<void> {
    const current = await currentGeneration()
    if (current === generationId || states.get(generationId) === 'published') {
      throw new Error(`Knowledge generation "${generationId}" is already published and cannot be abandoned.`)
    }
    states.set(generationId, 'abandoned')
    await deleteGeneration(generationId)
  }

  async function deleteGeneration(generationId: string): Promise<void> {
    const keys = await listKeys(generationPrefix(generationId))
    for (const key of keys) {
      await config.records.delete(key)
    }
  }

  function pointerKey(): string {
    return knowledgeCurrentKey(config.indexerId, config.namespace)
  }

  function generationPrefix(generationId: string): string {
    return knowledgeGenerationPrefix(config.indexerId, config.namespace, generationId)
  }

  return Object.freeze({
    currentGeneration,
    beginGeneration,
    publish,
    abandon,
  })

  async function listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await config.records.list(prefix, { cursor })
      keys.push(...page.entries.map((entry) => entry.key))
      cursor = page.cursor
    } while (cursor)
    return keys
  }
}

function assertValidGenerationId(generationId: string): void {
  if (generationId.length === 0) throw new Error('Knowledge generation id must not be empty.')
}

function assertGenerationRecord(
  record: { readonly generationId: string, readonly namespace: string },
  generationId: string,
  namespace: string,
): void {
  if (record.generationId !== generationId) {
    throw new Error(`Knowledge generation writer expected generation "${generationId}".`)
  }
  if (record.namespace !== namespace) {
    throw new Error(`Knowledge generation writer expected namespace "${namespace}".`)
  }
}

function assertBuilding(state: GenerationState | undefined, generationId: string): void {
  if (state !== 'building') throw new Error(`Knowledge generation "${generationId}" is not open for writes.`)
}

function assertPublishable(state: GenerationState | undefined, generationId: string): void {
  if (!state) throw new Error(`Unknown knowledge generation "${generationId}".`)
  if (state === 'abandoned') throw new Error(`Knowledge generation "${generationId}" was abandoned.`)
  if (state !== 'finished') throw new Error(`Knowledge generation "${generationId}" must be finished before publish.`)
}

function asCurrentGenerationRecord(value: JsonObject | null): KnowledgeCurrentGenerationRecord | null {
  if (
    !value ||
    value._cruxRecordType !== 'knowledge-current' ||
    typeof value.generationId !== 'string' ||
    typeof value.namespace !== 'string' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null
  }
  return value as unknown as KnowledgeCurrentGenerationRecord
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`
}
