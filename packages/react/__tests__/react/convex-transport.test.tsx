// @vitest-environment jsdom
/**
 * Tests for Convex store contract transport from @use-crux/convex.
 *
 * Verifies that the Convex transport correctly deserializes documents
 * stored in the _cruxDoc format (JSON-stringified content with marker metadata)
 * and resolves plan:*, tasklist:*, task:* key patterns to typed objects.
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlan, useTasks } from '../../src/hooks'
import { createConvexWrapper, createMockConvexBackend } from './convex-contract-harness'
import type { Plan, Task } from '@use-crux/core/plan'
import type { JsonObject } from '@use-crux/core/storage'

// ── plan:* key resolution ──

describe('Convex store contract transport — plan:* keys', () => {
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

// ── task:* prefix resolution ──

describe('Convex store contract transport — task:* prefix queries', () => {
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

describe('Convex store contract transport — metadata reactivity', () => {
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

    const { result, rerender } = renderHook(() => usePlan('plan-1'), {
      wrapper: createConvexWrapper(backend),
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

    const { result, rerender } = renderHook(() => useTasks('tl-1'), {
      wrapper: createConvexWrapper(backend),
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
