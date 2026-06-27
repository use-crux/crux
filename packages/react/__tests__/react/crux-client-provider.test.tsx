// @vitest-environment jsdom
/**
 * Tests for the CruxClientProvider pattern used in apps/web.
 *
 * Verifies that wrapping components in CruxProvider with a memoized
 * Convex store contract transport provides stable, reactive access to plans, task lists,
 * and tasks through the domain hooks.
 *
 * These tests mirror the exact pattern used in
 * apps/web/src/lib/convex/components/crux-provider.client.tsx
 */
import { describe, it, expect } from 'vitest'
import React, { useMemo, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { CruxProvider, useCruxTransport } from '../../src/provider'
import { usePlan, useTaskList, useTasks } from '../../src/hooks'
import { createConvexContractTransport, createMockConvexBackend } from './convex-contract-harness'
import type { Plan, TaskList, Task } from '@use-crux/core/plan'
import type { JsonObject } from '@use-crux/core/store'

// ── Memoized Provider (mirrors CruxClientProvider from apps/web) ──

/**
 * Simulates the CruxClientProvider from apps/web by creating a
 * memoized Convex store contract transport and wrapping in CruxProvider.
 */
function MemoizedCruxClientProvider({
  backend,
  children,
}: {
  backend: ReturnType<typeof createMockConvexBackend>
  children: ReactNode
}) {
  const transport = useMemo(() => createConvexContractTransport(backend), [backend])
  return <CruxProvider transport={transport}>{children}</CruxProvider>
}

// ── Tests ──

describe('CruxClientProvider pattern — memoized Convex store contract transport', () => {
  it('provides transport context to children via useCruxTransport', () => {
    const backend = createMockConvexBackend()

    const { result } = renderHook(() => useCruxTransport(), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeDefined()
    expect(typeof result.current.useDocument).toBe('function')
    expect(typeof result.current.useDocumentList).toBe('function')
  })

  it('usePlan resolves plan data with metadata.status through memoized transport', () => {
    const backend = createMockConvexBackend()
    const plan: Plan = {
      id: 'plan-writer-1',
      title: 'Blog Post Plan',
      content: '## Introduction\nWrite intro\n## Body\nWrite body',
      version: 1,
      metadata: {
        status: 'draft',
        draftId: 'draft-123',
        draftTitle: 'My Blog Post',
        instructions: [{ sectionLabel: 'Introduction' }, { sectionLabel: 'Body' }],
      },
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('plan:plan-writer-1', plan as unknown as JsonObject)

    const { result } = renderHook(() => usePlan('plan-writer-1'), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeDefined()
    expect(result.current!.title).toBe('Blog Post Plan')
    expect(result.current!.metadata!.status).toBe('draft')
    expect(result.current!.metadata!.draftId).toBe('draft-123')
  })

  it('useTaskList resolves task list by planId through memoized transport', () => {
    const backend = createMockConvexBackend()
    const taskList: TaskList = {
      id: 'tl-writer-1',
      planId: 'plan-writer-1',
      status: 'in_progress',
      createdAt: 1000,
      updatedAt: 2000,
    }
    backend.setDoc('tasklist:tl-writer-1', taskList as unknown as JsonObject)

    const { result } = renderHook(() => useTaskList({ planId: 'plan-writer-1' }), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeDefined()
    expect(result.current!.id).toBe('tl-writer-1')
    expect(result.current!.planId).toBe('plan-writer-1')
    expect(result.current!.status).toBe('in_progress')
  })

  it('useTasks resolves section tasks with assignee info through memoized transport', () => {
    const backend = createMockConvexBackend()
    const t1: Task = {
      id: 'section-0-intro',
      taskListId: 'tl-writer-1',
      label: 'Introduction',
      status: 'completed',
      assignee: { agent: 'writer', model: 'openai/gpt-4.1-mini' },
      durationMs: 5200,
      createdAt: 1000,
      updatedAt: 2000,
    }
    const t2: Task = {
      id: 'section-1-body',
      taskListId: 'tl-writer-1',
      label: 'Body',
      status: 'in_progress',
      progress: 'Writing Body...',
      assignee: { agent: 'writer', model: 'openai/gpt-4.1-mini' },
      createdAt: 1000,
      updatedAt: 2500,
    }
    const t3: Task = {
      id: 'section-2-conclusion',
      taskListId: 'tl-writer-1',
      label: 'Conclusion',
      status: 'pending',
      assignee: { agent: 'writer', model: 'openai/gpt-4.1-mini' },
      createdAt: 1000,
      updatedAt: 1000,
    }
    backend.setDoc('task:tl-writer-1:section-0-intro', t1 as unknown as JsonObject)
    backend.setDoc('task:tl-writer-1:section-1-body', t2 as unknown as JsonObject)
    backend.setDoc('task:tl-writer-1:section-2-conclusion', t3 as unknown as JsonObject)

    const { result } = renderHook(() => useTasks('tl-writer-1'), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeDefined()
    expect(result.current).toHaveLength(3)

    const completed = result.current!.find((t) => t.id === 'section-0-intro')
    expect(completed!.status).toBe('completed')
    expect(completed!.durationMs).toBe(5200)

    const inProgress = result.current!.find((t) => t.id === 'section-1-body')
    expect(inProgress!.status).toBe('in_progress')
    expect(inProgress!.progress).toBe('Writing Body...')

    const pending = result.current!.find((t) => t.id === 'section-2-conclusion')
    expect(pending!.status).toBe('pending')
    expect(pending!.assignee).toEqual({
      agent: 'writer',
      model: 'openai/gpt-4.1-mini',
    })
  })

  it('usePlan returns undefined when planId is undefined (skip pattern)', () => {
    const backend = createMockConvexBackend()

    const { result } = renderHook(() => usePlan(undefined), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeUndefined()
  })

  it('useTaskList returns undefined when filter is undefined (skip pattern)', () => {
    const backend = createMockConvexBackend()

    const { result } = renderHook(() => useTaskList(undefined), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeUndefined()
  })

  it('useTasks returns undefined when taskListId is undefined (skip pattern)', () => {
    const backend = createMockConvexBackend()

    const { result } = renderHook(() => useTasks(undefined), {
      wrapper: ({ children }) => <MemoizedCruxClientProvider backend={backend}>{children}</MemoizedCruxClientProvider>,
    })

    expect(result.current).toBeUndefined()
  })

  it('transport reference remains stable across re-renders', () => {
    const backend = createMockConvexBackend()
    const transportRefs: unknown[] = []

    function CaptureTransport() {
      const transport = useCruxTransport()
      transportRefs.push(transport)
      return null
    }

    const { rerender } = renderHook(() => null, {
      wrapper: ({ children }) => (
        <MemoizedCruxClientProvider backend={backend}>
          <CaptureTransport />
          {children}
        </MemoizedCruxClientProvider>
      ),
    })

    rerender()
    rerender()

    // All captured refs should be the same object (useMemo stability)
    expect(transportRefs.length).toBeGreaterThanOrEqual(2)
    expect(transportRefs[0]).toBe(transportRefs[1])
  })
})
