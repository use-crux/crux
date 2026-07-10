// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { createStreamTransport } from '../../src/stream/client'
import { CruxProvider, usePlan, useTasks } from '@use-crux/react'
import type { Task } from '@use-crux/core/plan'
import type { JsonObject } from '@use-crux/core/storage'
import type { CruxDataPart } from '../../src/stream/types'

function createWrapper(transport: ReturnType<typeof createStreamTransport>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <CruxProvider transport={transport}>{children}</CruxProvider>
  }
}

describe('createStreamTransport', () => {
  it('ingests a plan data part and usePlan reads it', () => {
    const transport = createStreamTransport()
    const plan = {
      id: 'p1',
      title: 'Test',
      content: '',
      version: 1,
      createdAt: 1000,
      updatedAt: 1000,
    } satisfies JsonObject

    // Ingest a crux data part
    transport.ingest({
      type: 'data-crux' as const,
      data: {
        entity: 'plan',
        key: 'plan:p1',
        value: plan,
        event: 'put',
      } satisfies CruxDataPart,
    })

    const { result } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.title).toBe('Test')
  })

  it('ingests task data parts and useTasks reads them', () => {
    const transport = createStreamTransport()
    const task1: Task = {
      id: 't1',
      taskListId: 'list-1',
      label: 'Research',
      status: 'pending',
      createdAt: 1000,
      updatedAt: 1000,
    }
    const task2: Task = {
      id: 't2',
      taskListId: 'list-1',
      label: 'Write',
      status: 'pending',
      createdAt: 1000,
      updatedAt: 1000,
    }

    transport.ingest({
      type: 'data-crux' as const,
      data: {
        entity: 'task',
        key: 'task:list-1:t1',
        value: task1,
        event: 'put',
      },
    })
    transport.ingest({
      type: 'data-crux' as const,
      data: {
        entity: 'task',
        key: 'task:list-1:t2',
        value: task2,
        event: 'put',
      },
    })

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toHaveLength(2)
  })

  it('updates existing data on re-ingest', () => {
    const transport = createStreamTransport()
    const plan = {
      id: 'p1',
      title: 'V1',
      content: '',
      version: 1,
      createdAt: 1000,
      updatedAt: 1000,
    } satisfies JsonObject

    transport.ingest({
      type: 'data-crux' as const,
      data: { entity: 'plan', key: 'plan:p1', value: plan, event: 'put' },
    })

    const { result, rerender } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current!.title).toBe('V1')

    // Update
    act(() => {
      transport.ingest({
        type: 'data-crux' as const,
        data: {
          entity: 'plan',
          key: 'plan:p1',
          value: { ...plan, title: 'V2', version: 2 },
          event: 'put',
        },
      })
    })

    rerender()
    expect(result.current!.title).toBe('V2')
  })

  it('handles delete events', () => {
    const transport = createStreamTransport()
    const plan = {
      id: 'p1',
      title: 'Test',
      content: '',
      version: 1,
      createdAt: 1000,
      updatedAt: 1000,
    } satisfies JsonObject

    transport.ingest({
      type: 'data-crux' as const,
      data: { entity: 'plan', key: 'plan:p1', value: plan, event: 'put' },
    })

    const { result, rerender } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current).not.toBeUndefined()

    act(() => {
      transport.ingest({
        type: 'data-crux' as const,
        data: { entity: 'plan', key: 'plan:p1', value: null, event: 'delete' },
      })
    })

    rerender()
    expect(result.current).toBeUndefined()
  })

  it('excludes removed tasks', () => {
    const transport = createStreamTransport()

    transport.ingest({
      type: 'data-crux' as const,
      data: {
        entity: 'task',
        key: 'task:list-1:t1',
        value: {
          id: 't1',
          taskListId: 'list-1',
          label: 'Keep',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 1000,
        },
        event: 'put',
      },
    })
    transport.ingest({
      type: 'data-crux' as const,
      data: {
        entity: 'task',
        key: 'task:list-1:t2',
        value: {
          id: 't2',
          taskListId: 'list-1',
          label: 'Remove',
          status: 'pending',
          removedAt: 2000,
          createdAt: 1000,
          updatedAt: 1000,
        },
        event: 'put',
      },
    })

    const { result } = renderHook(() => useTasks('list-1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toHaveLength(1)
    expect(result.current![0].id).toBe('t1')
  })

  it('ignores non-crux data parts', () => {
    const transport = createStreamTransport()

    // Should not throw
    transport.ingest({ type: 'data-other' as any, data: { foo: 'bar' } })

    const { result } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current).toBeUndefined()
  })

  it('clear() resets all accumulated data', () => {
    const transport = createStreamTransport()
    transport.ingest({
      type: 'data-crux' as const,
      data: {
        entity: 'plan',
        key: 'plan:p1',
        value: { id: 'p1', title: 'Test' },
        event: 'put',
      },
    })

    const { result, rerender } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current).not.toBeUndefined()

    act(() => {
      transport.clear()
    })

    rerender()
    expect(result.current).toBeUndefined()
  })
})
