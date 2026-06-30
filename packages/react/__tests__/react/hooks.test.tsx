// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import * as ReactBindings from '../../src'
import { usePlan, useTasks } from '../../src/hooks'
import { CruxProvider, useCruxTransport } from '../../src/provider'
import { createMockTransport } from '../../src/testing'
import type { Plan, PlanHandle, Task, TasksHandle } from '@use-crux/core/plan'
import type { JsonObject } from '@use-crux/core/storage'

// ── Test Helpers ──

describe('@use-crux/react public hook exports', () => {
  it('does not export legacy task-list hook aliases', () => {
    expect('useTaskList' in ReactBindings).toBe(false)
  })
})

function createTestPlan(overrides?: Partial<Plan>): Plan {
  return {
    id: 'plan-1',
    title: 'Test Plan',
    content: 'Plan content',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function createTestTask(overrides?: Partial<Task>): Task {
  return {
    id: 't1',
    taskListId: 'list-1',
    label: 'Test task',
    status: 'pending',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function createWrapper(transport: ReturnType<typeof createMockTransport>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <CruxProvider transport={transport}>{children}</CruxProvider>
  }
}

// ── usePlan ──

describe('usePlan', () => {
  it('returns a Plan when the document exists', () => {
    const plan = createTestPlan()
    const transport = createMockTransport()
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)

    const { result } = renderHook(() => usePlan('plan-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.id).toBe('plan-1')
    expect(result.current!.title).toBe('Test Plan')
    expect(result.current!.version).toBe(1)
  })

  it('returns undefined when document does not exist', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => usePlan('nonexistent'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toBeUndefined()
  })

  it('returns undefined when planId is undefined (skip)', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => usePlan(undefined), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toBeUndefined()
  })

  it('accepts a canonical plan handle', () => {
    const plan = createTestPlan()
    const transport = createMockTransport()
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)
    const handle = { id: plan.id } as PlanHandle

    const { result } = renderHook(() => usePlan(handle), {
      wrapper: createWrapper(transport),
    })

    expect(result.current?.id).toBe('plan-1')
  })

  it('re-renders when the plan changes', () => {
    const transport = createMockTransport()
    const plan = createTestPlan()
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)

    const { result, rerender } = renderHook(() => usePlan('plan-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current!.title).toBe('Test Plan')

    act(() => {
      transport.put(`plan:${plan.id}`, {
        ...plan,
        title: 'Updated Title',
        version: 2,
      } as unknown as JsonObject)
    })

    rerender()
    expect(result.current!.title).toBe('Updated Title')
    expect(result.current!.version).toBe(2)
  })
})

// ── usePlan — metadata reactivity ──

describe('usePlan — metadata', () => {
  it('returns plan with metadata.status accessible', () => {
    const transport = createMockTransport()
    const plan = createTestPlan({
      metadata: { status: 'draft', instructions: [] },
    })
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)

    const { result } = renderHook(() => usePlan('plan-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.metadata).toBeDefined()
    expect(result.current!.metadata!.status).toBe('draft')
  })

  it('reflects metadata.status changes reactively', () => {
    const transport = createMockTransport()
    const plan = createTestPlan({
      metadata: { status: 'draft' },
    })
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)

    const { result, rerender } = renderHook(() => usePlan('plan-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current!.metadata!.status).toBe('draft')

    // Simulate plan approval
    act(() => {
      transport.put(`plan:${plan.id}`, {
        ...plan,
        metadata: { status: 'approved' },
        version: 2,
        updatedAt: 2000,
      } as unknown as JsonObject)
    })

    rerender()
    expect(result.current!.metadata!.status).toBe('approved')
    expect(result.current!.version).toBe(2)
  })

  it('tracks full metadata lifecycle: draft → approved → executing → completed', () => {
    const transport = createMockTransport()
    const plan = createTestPlan({ metadata: { status: 'draft' } })
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)

    const { result, rerender } = renderHook(() => usePlan('plan-1'), {
      wrapper: createWrapper(transport),
    })

    const statuses: Array<string | undefined> = []
    statuses.push(result.current!.metadata!.status as string)

    const transitions = ['approved', 'executing', 'completed'] as const
    for (const status of transitions) {
      act(() => {
        transport.put(`plan:${plan.id}`, {
          ...plan,
          metadata: { status },
        } as unknown as JsonObject)
      })
      rerender()
      statuses.push(result.current!.metadata!.status as string)
    }

    expect(statuses).toEqual(['draft', 'approved', 'executing', 'completed'])
  })

  it('preserves other metadata fields when status changes', () => {
    const transport = createMockTransport()
    const plan = createTestPlan({
      metadata: {
        status: 'draft',
        instructions: ['a', 'b'],
        articleBrief: 'test',
      },
    })
    transport.put(`plan:${plan.id}`, plan as unknown as JsonObject)

    const { result, rerender } = renderHook(() => usePlan('plan-1'), {
      wrapper: createWrapper(transport),
    })

    act(() => {
      transport.put(`plan:${plan.id}`, {
        ...plan,
        metadata: {
          status: 'approved',
          instructions: ['a', 'b'],
          articleBrief: 'test',
        },
      } as unknown as JsonObject)
    })

    rerender()
    expect(result.current!.metadata!.status).toBe('approved')
    expect(result.current!.metadata!.instructions).toEqual(['a', 'b'])
    expect(result.current!.metadata!.articleBrief).toBe('test')
  })
})

// ── useTasks ──

describe('useTasks', () => {
  it('returns Task[] for a task list', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({ id: 't1' })
    const t2 = createTestTask({ id: 't2', label: 'Second task' })
    transport.put(`task:list-1:t1`, t1 as unknown as JsonObject)
    transport.put(`task:list-1:t2`, t2 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current).toHaveLength(2)
  })

  it('returns undefined when taskListId is undefined (skip)', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => useTasks(undefined), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toBeUndefined()
  })

  it('accepts a canonical tasks handle', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({ id: 'from-handle' })
    transport.put(`task:list-1:from-handle`, t1 as unknown as JsonObject)
    const handle = { id: 'list-1' } as TasksHandle

    const { result } = renderHook(() => useTasks(handle), {
      wrapper: createWrapper(transport),
    })

    expect(result.current?.map((task) => task.id)).toEqual(['from-handle'])
  })

  it('excludes removed tasks (removedAt set)', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({ id: 't1' })
    const t2 = createTestTask({ id: 't2', removedAt: 2000 })
    transport.put(`task:list-1:t1`, t1 as unknown as JsonObject)
    transport.put(`task:list-1:t2`, t2 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toHaveLength(1)
    expect(result.current![0].id).toBe('t1')
  })

  it('returns empty array when no tasks exist', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current).toHaveLength(0)
  })

  it('re-renders when tasks change', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({ id: 't1', status: 'pending' })
    transport.put(`task:list-1:t1`, t1 as unknown as JsonObject)

    const { result, rerender } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current![0].status).toBe('pending')

    act(() => {
      transport.put(`task:list-1:t1`, {
        ...t1,
        status: 'completed',
      } as unknown as JsonObject)
    })

    rerender()
    expect(result.current![0].status).toBe('completed')
  })

  it('tracks task progress through pending → in_progress → completed', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({ id: 'section-0-intro', status: 'pending' })
    const t2 = createTestTask({ id: 'section-1-body', status: 'pending' })
    transport.put('task:list-1:section-0-intro', t1 as unknown as JsonObject)
    transport.put('task:list-1:section-1-body', t2 as unknown as JsonObject)

    const { result, rerender } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toHaveLength(2)
    expect(result.current!.every((t) => t.status === 'pending')).toBe(true)

    // First task starts
    act(() => {
      transport.put('task:list-1:section-0-intro', {
        ...t1,
        status: 'in_progress',
        progress: 'Writing introduction section...',
      } as unknown as JsonObject)
    })
    rerender()
    const intro = result.current!.find((t) => t.id === 'section-0-intro')
    expect(intro!.status).toBe('in_progress')
    expect(intro!.progress).toBe('Writing introduction section...')

    // First task completes, second starts
    act(() => {
      transport.put('task:list-1:section-0-intro', {
        ...t1,
        status: 'completed',
        durationMs: 5000,
      } as unknown as JsonObject)
      transport.put('task:list-1:section-1-body', {
        ...t2,
        status: 'in_progress',
        progress: 'Writing body section...',
      } as unknown as JsonObject)
    })
    rerender()
    expect(result.current!.find((t) => t.id === 'section-0-intro')!.status).toBe('completed')
    expect(result.current!.find((t) => t.id === 'section-1-body')!.status).toBe('in_progress')
  })

  it('reflects task assignee information', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({
      id: 'research',
      assignee: { agent: 'writer', model: 'claude-sonnet-4-5' },
    })
    transport.put('task:list-1:research', t1 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current![0].assignee).toEqual({
      agent: 'writer',
      model: 'claude-sonnet-4-5',
    })
  })

  it('handles failed tasks with error messages', () => {
    const transport = createMockTransport()
    const t1 = createTestTask({
      id: 'write-section',
      status: 'failed',
      error: 'Token limit exceeded',
    })
    transport.put('task:list-1:write-section', t1 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current![0].status).toBe('failed')
    expect(result.current![0].error).toBe('Token limit exceeded')
  })
})

// ── CruxProvider ──

describe('CruxProvider', () => {
  it('throws when hooks are used outside provider', () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => usePlan('plan-1'))
    }).toThrow('no CruxProvider found')

    spy.mockRestore()
  })

  it('useCruxTransport returns the transport', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => useCruxTransport(), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toBe(transport)
  })
})
