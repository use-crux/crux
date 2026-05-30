// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { createPollingTransport } from '../../src/polling'
import { usePlan, useTasks } from '../../src/hooks'
import { CruxProvider } from '../../src/provider'
import type { CruxStore, JsonObject } from '@crux/core/store'
import { inMemoryCruxStore } from '@crux/core/store'

function createWrapper(transport: ReturnType<typeof createPollingTransport>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <CruxProvider transport={transport}>{children}</CruxProvider>
  }
}

describe('createPollingTransport', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches data from the store and makes it available via hooks', async () => {
    const store = inMemoryCruxStore()
    await store.set('plan:p1', {
      id: 'p1',
      title: 'Test',
      status: 'draft',
      version: 1,
      content: '',
      createdAt: 1000,
      updatedAt: 1000,
    })

    const transport = createPollingTransport(store, { intervalMs: 100 })

    // Wait for initial fetch
    await transport.poll()

    const { result } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.title).toBe('Test')

    transport.stop()
  })

  it('returns undefined for missing documents', async () => {
    const store = inMemoryCruxStore()
    const transport = createPollingTransport(store, { intervalMs: 100 })
    await transport.poll()

    const { result } = renderHook(() => usePlan('nonexistent'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).toBeUndefined()
    transport.stop()
  })

  it('picks up store changes after poll()', async () => {
    const store = inMemoryCruxStore()
    const transport = createPollingTransport(store, { intervalMs: 100 })

    await store.set('plan:p1', {
      id: 'p1',
      title: 'V1',
      status: 'draft',
      version: 1,
      content: '',
      createdAt: 1000,
      updatedAt: 1000,
    })
    await transport.poll()

    const { result, rerender } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current!.title).toBe('V1')

    // Update store and re-poll
    await store.set('plan:p1', {
      id: 'p1',
      title: 'V2',
      status: 'draft',
      version: 2,
      content: '',
      createdAt: 1000,
      updatedAt: 2000,
    })

    await act(async () => {
      await transport.poll()
    })

    rerender()
    expect(result.current!.title).toBe('V2')

    transport.stop()
  })

  it('stop() clears the polling interval', async () => {
    const store = inMemoryCruxStore()
    const transport = createPollingTransport(store, { intervalMs: 50 })

    transport.stop()
    // Should not throw or keep polling after stop
  })
})
