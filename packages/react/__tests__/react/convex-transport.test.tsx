// @vitest-environment jsdom
/**
 * Tests for createConvexTransport from @crux/convex/react.
 *
 * Verifies that the Convex transport correctly deserializes documents
 * stored in the _cruxDoc format (JSON-stringified content with marker metadata)
 * and resolves plan:*, tasklist:*, task:* key patterns to typed objects.
 */
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { createConvexTransport } from '../../../convex/react'
import { CruxProvider } from '../../src/provider'
import { usePlan, useTaskList, useTasks } from '../../src/hooks'
import type { Plan, TaskList, Task } from '@crux/core/plan'
import type { JsonObject } from '@crux/core/store'

// ── Mock Convex API ──

/**
 * Simulates Convex's useQuery hook + memory component API.
 *
 * Documents are stored in the same format that cruxConvexStore.set() writes:
 * - content: JSON-stringified JsonObject
 * - metadata: { _cruxDoc: true }
 */
function createMockConvexBackend() {
  const data = new Map<string, Record<string, unknown>>()
  let version = 0
  const listeners = new Set<() => void>()

  const api = {
    memory: {
      get: Symbol('memory.get'),
      list: Symbol('memory.list'),
    },
  }

  function notify() {
    version++
    for (const listener of listeners) listener()
  }

  /** Store a document in the _cruxDoc serialization format. */
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
   * Mock useQuery that simulates Convex's behavior.
   * Returns data synchronously (like Convex's reactive queries after hydration).
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

function createConvexWrapper(backend: ReturnType<typeof createMockConvexBackend>) {
  const transport = createConvexTransport({
    api: backend.api,
    useQuery: backend.useQuery,
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <CruxProvider transport={transport}>{children}</CruxProvider>
  }
}

// ── plan:* key resolution ──

describe('createConvexTransport — plan:* keys', () => {
  it('resolves plan:* key to a deserialized Plan object', () => {
    const backend = createMockConvexBackend()
    const plan: Plan = {
      id: 'plan-abc',
      title: 'Content Strategy',
      content: '## Introduction\nWrite an intro section.',
      version: 1,
      metadata: { status: 'draft' },
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('plan:plan-abc', plan as unknown as JsonObject)

    const { result } = renderHook(() => usePlan('plan-abc'), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.id).toBe('plan-abc')
    expect(result.current!.title).toBe('Content Strategy')
    expect(result.current!.content).toBe('## Introduction\nWrite an intro section.')
    expect(result.current!.version).toBe(1)
    expect(result.current!.metadata).toEqual({ status: 'draft' })
  })

  it('returns undefined for non-existent plan', () => {
    const backend = createMockConvexBackend()

    const { result } = renderHook(() => usePlan('nonexistent'), {
      wrapper: createConvexWrapper(backend),
    })

    // null from transport.useDocument gets mapped to undefined by usePlan
    expect(result.current).toBeUndefined()
  })

  it('deserializes plan metadata.status correctly through _cruxDoc format', () => {
    const backend = createMockConvexBackend()
    const plan: Plan = {
      id: 'plan-1',
      title: 'Test',
      content: 'Content',
      version: 1,
      metadata: { status: 'approved', instructions: [{ type: 'add' }] },
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('plan:plan-1', plan as unknown as JsonObject)

    const { result } = renderHook(() => usePlan('plan-1'), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current!.metadata!.status).toBe('approved')
    expect(result.current!.metadata!.instructions).toEqual([{ type: 'add' }])
  })
})

// ── tasklist:* key resolution ──

describe('createConvexTransport — tasklist:* keys', () => {
  it('resolves tasklist:* key to a deserialized TaskList object', () => {
    const backend = createMockConvexBackend()
    const list: TaskList = {
      id: 'tl-1',
      planId: 'plan-abc',
      status: 'in_progress',
      metadata: { threadId: 'thread-123' },
      createdAt: 1000,
      updatedAt: 2000,
    }
    backend.setDoc('tasklist:tl-1', list as unknown as JsonObject)

    const { result } = renderHook(() => useTaskList('tl-1'), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.id).toBe('tl-1')
    expect(result.current!.planId).toBe('plan-abc')
    expect(result.current!.status).toBe('in_progress')
  })

  it('resolves tasklist by planId filter', () => {
    const backend = createMockConvexBackend()
    const list: TaskList = {
      id: 'tl-1',
      planId: 'plan-abc',
      status: 'pending',
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('tasklist:tl-1', list as unknown as JsonObject)

    const { result } = renderHook(() => useTaskList({ planId: 'plan-abc' }), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.id).toBe('tl-1')
  })
})

// ── task:* prefix resolution ──

describe('createConvexTransport — task:* prefix queries', () => {
  it('resolves task:* prefix to deserialized Task[] array', () => {
    const backend = createMockConvexBackend()
    const t1: Task = {
      id: 'section-0-intro',
      taskListId: 'tl-1',
      label: 'Write introduction',
      status: 'completed',
      durationMs: 3000,
      createdAt: 1000,
      updatedAt: 2000,
    }
    const t2: Task = {
      id: 'section-1-body',
      taskListId: 'tl-1',
      label: 'Write body',
      status: 'in_progress',
      progress: 'Generating content...',
      assignee: { agent: 'writer', model: 'claude-sonnet-4-5' },
      createdAt: 1000,
      updatedAt: 2500,
    }
    backend.setDoc('task:tl-1:section-0-intro', t1 as unknown as JsonObject)
    backend.setDoc('task:tl-1:section-1-body', t2 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('tl-1'), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current).toHaveLength(2)

    const intro = result.current!.find((t) => t.id === 'section-0-intro')
    expect(intro!.status).toBe('completed')
    expect(intro!.durationMs).toBe(3000)

    const body = result.current!.find((t) => t.id === 'section-1-body')
    expect(body!.status).toBe('in_progress')
    expect(body!.progress).toBe('Generating content...')
    expect(body!.assignee).toEqual({
      agent: 'writer',
      model: 'claude-sonnet-4-5',
    })
  })

  it('excludes removed tasks', () => {
    const backend = createMockConvexBackend()
    const t1: Task = {
      id: 'active',
      taskListId: 'tl-1',
      label: 'Active task',
      status: 'pending',
      createdAt: 1000,
      updatedAt: 1000,
    }
    const t2: Task = {
      id: 'removed',
      taskListId: 'tl-1',
      label: 'Removed task',
      status: 'cancelled',
      removedAt: 2000,
      createdAt: 1000,
      updatedAt: 2000,
    }
    backend.setDoc('task:tl-1:active', t1 as unknown as JsonObject)
    backend.setDoc('task:tl-1:removed', t2 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('tl-1'), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current).toHaveLength(1)
    expect(result.current![0].id).toBe('active')
  })

  it('returns empty array for task list with no tasks', () => {
    const backend = createMockConvexBackend()

    const { result } = renderHook(() => useTasks('tl-empty'), {
      wrapper: createConvexWrapper(backend),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current).toHaveLength(0)
  })
})

// ── metadata reactivity through Convex transport ──

describe('createConvexTransport — metadata reactivity', () => {
  it('reflects plan metadata.status changes reactively', () => {
    const backend = createMockConvexBackend()
    const plan: Plan = {
      id: 'plan-1',
      title: 'Test Plan',
      content: 'Content',
      version: 1,
      metadata: { status: 'draft' },
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('plan:plan-1', plan as unknown as JsonObject)

    // Need to recreate wrapper on each render to pick up updated mock data
    const transport = createConvexTransport({
      api: backend.api,
      useQuery: backend.useQuery,
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CruxProvider transport={transport}>{children}</CruxProvider>
    )

    const { result, rerender } = renderHook(() => usePlan('plan-1'), {
      wrapper,
    })

    expect(result.current!.metadata!.status).toBe('draft')

    // Simulate backend update
    backend.setDoc('plan:plan-1', {
      ...plan,
      metadata: { status: 'approved' },
      version: 2,
      updatedAt: 2000,
    } as unknown as JsonObject)

    rerender()
    expect(result.current!.metadata!.status).toBe('approved')
  })

  it('reflects task status updates reactively', () => {
    const backend = createMockConvexBackend()
    const task: Task = {
      id: 'write-intro',
      taskListId: 'tl-1',
      label: 'Write intro',
      status: 'pending',
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('task:tl-1:write-intro', task as unknown as JsonObject)

    const transport = createConvexTransport({
      api: backend.api,
      useQuery: backend.useQuery,
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CruxProvider transport={transport}>{children}</CruxProvider>
    )

    const { result, rerender } = renderHook(() => useTasks('tl-1'), {
      wrapper,
    })

    expect(result.current![0].status).toBe('pending')

    backend.setDoc('task:tl-1:write-intro', {
      ...task,
      status: 'in_progress',
      progress: 'Writing...',
      updatedAt: 2000,
    } as unknown as JsonObject)

    rerender()
    expect(result.current![0].status).toBe('in_progress')
    expect(result.current![0].progress).toBe('Writing...')
  })
})
