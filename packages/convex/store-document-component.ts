/**
 * Normalized Convex store document component helpers.
 *
 * These helpers keep the public contract ergonomic for generated Convex
 * components while giving tests and alternate runtimes a single component
 * substitute that drives server stores and React reads from the same records.
 *
 * @module
 */

import { createConvexTransport, type UseQueryFn } from './react'
import type { ConvexCtxPort } from './store'
import type {
  ConvexCruxStoreComponent,
  ConvexCruxStoreMemoryComponent,
  ConvexStoreDocumentComponent,
  ConvexStoreDocumentComponentIoOptions,
  ConvexStoreDocumentComponentReadOptions,
} from './store-component'
import type {
  ComponentDocumentPort,
  StoreDocDenseSearchQuery,
  StoreDocPage,
  StoreDocPageQuery,
  StoreDocRecord,
  StoreDocWrite,
} from './store-doc'
import { STORE_DOC_COMPONENT_SPEC } from './store-doc'

/** Options for `createInMemoryConvexStoreDocumentComponent()`. */
export interface InMemoryConvexStoreDocumentComponentOptions {
  /** Initial raw documents available to server stores and React reads. */
  readonly docs?: readonly StoreDocRecord[]
  /**
   * Optional dense-search substitute.
   *
   * Return documents in relevance order and include `_score` on records when a
   * vector score should be surfaced by `CruxStore.searchVectors()`.
   */
  readonly denseSearch?: (query: StoreDocDenseSearchQuery, docs: readonly StoreDocRecord[]) => readonly StoreDocRecord[]
}

/**
 * In-memory normalized component for boundary tests.
 *
 * The fake exposes generated-like refs, a server ctx, a `useQuery` substitute,
 * and the normalized component methods expected by `defineConvexStoreContract`.
 */
export interface InMemoryConvexStoreDocumentComponent extends ConvexStoreDocumentComponent<ConvexCtxPort> {
  /** Generated-like memory refs, also exposed at the top level for compatibility. */
  readonly memory: ConvexCruxStoreMemoryComponent
  /** Structural Convex ctx substitute backed by the in-memory records. */
  readonly ctx: ConvexCtxPort
  /** Convex `useQuery` substitute backed by the in-memory records. */
  readonly useQuery: UseQueryFn
  /** Return a snapshot of the raw backing records in key order. */
  snapshot(): readonly StoreDocRecord[]
}

/** Return whether a component uses the normalized document component contract. */
export function isConvexStoreDocumentComponent<TCtx extends ConvexCtxPort>(
  component: ConvexCruxStoreComponent | ConvexStoreDocumentComponent<TCtx>,
): component is ConvexStoreDocumentComponent<TCtx> {
  return (
    typeof (component as Partial<ConvexStoreDocumentComponent<TCtx>>).io === 'function' &&
    typeof (component as Partial<ConvexStoreDocumentComponent<TCtx>>).reads === 'function' &&
    (component as Partial<ConvexStoreDocumentComponent<TCtx>>).table === STORE_DOC_COMPONENT_SPEC.table
  )
}

/**
 * Create an in-memory Convex store document component.
 *
 * Use this in contract tests when server-side writes and React reads should
 * observe the same component records without running Convex.
 */
export function createInMemoryConvexStoreDocumentComponent(
  options: InMemoryConvexStoreDocumentComponentOptions = {},
): InMemoryConvexStoreDocumentComponent {
  const refs: ConvexCruxStoreComponent = {
    memory: {
      get: Symbol('memory.get'),
      list: Symbol('memory.list'),
      set: Symbol('memory.set'),
      insert: Symbol('memory.insert'),
      remove: Symbol('memory.remove'),
    },
  }
  const docs = new Map<string, StoreDocRecord>()
  for (const doc of options.docs ?? []) {
    docs.set(String(doc.key), doc)
  }

  const port: ComponentDocumentPort = {
    async get(key) {
      return docs.get(key) ?? null
    },
    async list(query) {
      return listDocs(docs, query)
    },
    async put(doc) {
      docs.set(doc.key, doc)
    },
    async insert(doc) {
      if (docs.has(doc.key)) return false
      docs.set(doc.key, doc)
      return true
    },
    async delete(key) {
      docs.delete(key)
    },
    async searchDense(query) {
      return options.denseSearch ? options.denseSearch(query, sortedDocs(docs)) : []
    },
  }

  const ctx: ConvexCtxPort = {
    async runQuery<TResult = unknown>(ref: unknown, args: Record<string, unknown>): Promise<TResult> {
      let result: unknown
      if (ref === refs.memory.get) {
        result = await port.get(String(args.key))
        return result as TResult
      }
      if (ref === refs.memory.list) {
        result = await port.list(pageQueryFromArgs(args))
        return result as TResult
      }
      return undefined as TResult
    },
    async runMutation<TResult = unknown>(ref: unknown, args: Record<string, unknown>): Promise<TResult> {
      if (ref === refs.memory.set) {
        await port.put(args as StoreDocWrite)
        return null as TResult
      }
      if (ref === refs.memory.insert) {
        return (await port.insert(args as StoreDocWrite)) as TResult
      }
      if (ref === refs.memory.remove) {
        await port.delete(String(args.key))
        return null as TResult
      }
      return undefined as TResult
    },
  }

  const useQuery: UseQueryFn = (query, args) => {
    if (args === 'skip') return undefined
    if (query === refs.memory.get) return docs.get(String(args.key)) ?? null
    if (query === refs.memory.list) return listDocs(docs, pageQueryFromArgs(args))
    return undefined
  }

  return {
    refs,
    memory: refs.memory,
    table: STORE_DOC_COMPONENT_SPEC.table,
    ctx,
    useQuery,
    io(_ctx: ConvexCtxPort, _options: ConvexStoreDocumentComponentIoOptions) {
      return port
    },
    reads(args: ConvexStoreDocumentComponentReadOptions) {
      return createConvexTransport({
        api: args.api ?? refs,
        now: args.now,
        useQuery: args.useQuery,
      })
    },
    snapshot() {
      return sortedDocs(docs)
    },
  }
}

function listDocs(docs: Map<string, StoreDocRecord>, query: StoreDocPageQuery): StoreDocPage {
  const limit = normalizeLimit(query.limit)
  if (limit <= 0) {
    return { docs: [] }
  }

  const page = sortedDocs(docs)
    .filter((doc) => startsWithPrefix(doc, query.prefix))
    .filter((doc) => query.cursor === undefined || String(doc.key) > query.cursor)
    .slice(0, limit + 1)
  const docsPage = page.slice(0, limit)
  const last = docsPage.at(-1)

  return {
    docs: docsPage,
    ...(page.length > limit && last ? { cursor: String(last.key) } : {}),
  }
}

function sortedDocs(docs: Map<string, StoreDocRecord>): readonly StoreDocRecord[] {
  return [...docs.values()].sort((left, right) => String(left.key).localeCompare(String(right.key)))
}

function startsWithPrefix(doc: StoreDocRecord, prefix: string): boolean {
  return String(doc.key).startsWith(prefix)
}

function normalizeLimit(limit: number | undefined): number {
  return Math.max(0, Math.floor(limit ?? STORE_DOC_COMPONENT_SPEC.defaultListLimit))
}

function pageQueryFromArgs(args: Record<string, unknown>): StoreDocPageQuery {
  return {
    prefix: typeof args.prefix === 'string' ? args.prefix : '',
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
  }
}
