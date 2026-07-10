import React, { type ReactNode } from 'react'
import { createConvexTransport } from '../../../convex/src/react'
import { CruxProvider } from '../../src/provider'
import type { JsonObject } from '@use-crux/core/storage'

/**
 * In-memory Convex component/query harness for React transport tests.
 *
 * It stores current Crux records and exposes the same component query shape
 * used by `createConvexTransport()`.
 */
export function createMockConvexBackend() {
  const data = new Map<string, Record<string, unknown>>()
  const listeners = new Set<() => void>()

  const api = {
    memory: {
      get: Symbol('memory.get'),
      list: Symbol('memory.list'),
      set: Symbol('memory.set'),
      insert: Symbol('memory.insert'),
      remove: Symbol('memory.remove'),
    },
  }

  function notify() {
    for (const listener of listeners) listener()
  }

  /** Store a document in the current Crux store document format. */
  function setDoc(key: string, value: JsonObject) {
    data.set(key, {
      _id: `id_${key}`,
      key,
      content: JSON.stringify(value),
      metadata: { _cruxDoc: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    notify()
  }

  function deleteDoc(key: string) {
    data.delete(key)
    notify()
  }

  /**
   * Mock `useQuery` that returns data synchronously, like Convex reactive
   * queries after hydration.
   */
  function useQuery(query: unknown, args: unknown): unknown {
    if (args === 'skip') return undefined

    const typedArgs = args as Record<string, unknown>

    if (query === api.memory.get) {
      return data.get(typedArgs.key as string) ?? null
    }

    if (query === api.memory.list) {
      const prefix = typedArgs.prefix as string
      const entries: Array<Record<string, unknown>> = []
      for (const [key, value] of data) {
        if (key.startsWith(prefix)) {
          entries.push({ ...value, key })
        }
      }
      return { docs: entries }
    }

    return undefined
  }

  return { api, useQuery, setDoc, deleteDoc, data }
}

/** Create a `CruxProvider` wrapper from the Convex storage transport. */
export function createConvexWrapper(backend: ReturnType<typeof createMockConvexBackend>) {
  const transport = createConvexTransport({ api: backend.api, useQuery: backend.useQuery })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <CruxProvider transport={transport}>{children}</CruxProvider>
  }
}

/** Create the storage transport used by app-provider tests. */
export function createConvexContractTransport(backend: ReturnType<typeof createMockConvexBackend>) {
  return createConvexTransport({ api: backend.api, useQuery: backend.useQuery })
}
