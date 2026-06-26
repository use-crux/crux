// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { createSSETransport } from '../../src/sse'
import { usePlan } from '../../src/hooks'
import { CruxProvider } from '../../src/provider'
import type { JsonObject } from '@use-crux/core/store'

// ── Mock EventSource ──

type EventSourceListener = (event: MessageEvent) => void

let mockInstance: {
  onopen: (() => void) | null
  onerror: (() => void) | null
  listeners: Map<string, EventSourceListener>
  close: ReturnType<typeof vi.fn>
  url: string
} | null = null

class MockEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, EventSourceListener>()
  close = vi.fn()
  url: string

  constructor(url: string) {
    this.url = url
    mockInstance = {
      onopen: null,
      onerror: null,
      listeners: this.listeners,
      close: this.close,
      url,
    }
    // Defer so the transport can set handlers
    setTimeout(() => {
      mockInstance!.onopen = this.onopen
      mockInstance!.onerror = this.onerror
      this.onopen?.()
    }, 0)
  }

  addEventListener(type: string, listener: EventSourceListener) {
    this.listeners.set(type, listener)
    mockInstance!.listeners = this.listeners
  }

  removeEventListener(type: string) {
    this.listeners.delete(type)
  }
}

function sendEvent(key: string, value: JsonObject | null, event: 'set' | 'delete' = 'set') {
  const listener = mockInstance?.listeners.get('data-crux')
  if (!listener) throw new Error('No data-crux listener registered')

  const entity = key.startsWith('plan:') ? 'plan' : key.startsWith('tasklist:') ? 'tasklist' : 'task'
  const data = JSON.stringify({ entity, key, value, event })
  listener(new MessageEvent('data-crux', { data }))
}

function createWrapper(transport: ReturnType<typeof createSSETransport>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <CruxProvider transport={transport}>{children}</CruxProvider>
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource)
  mockInstance = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSSETransport', () => {
  it('connects to the given URL', () => {
    const transport = createSSETransport('/api/crux/events')
    expect(mockInstance).not.toBeNull()
    expect(mockInstance!.url).toBe('/api/crux/events')
    transport.close()
  })

  it('receives set events and makes data available via hooks', async () => {
    const transport = createSSETransport('/api/crux/events')

    // Wait for connection
    await new Promise((r) => setTimeout(r, 10))

    // Send a plan event
    sendEvent('plan:p1', {
      id: 'p1',
      title: 'Test Plan',
      content: '',
      version: 1,
      createdAt: 1000,
      updatedAt: 1000,
    })

    const { result } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })

    expect(result.current).not.toBeUndefined()
    expect(result.current!.title).toBe('Test Plan')
    transport.close()
  })

  it('handles delete events', async () => {
    const transport = createSSETransport('/api/crux/events')
    await new Promise((r) => setTimeout(r, 10))

    sendEvent('plan:p1', {
      id: 'p1',
      title: 'Test',
      version: 1,
      content: '',
      createdAt: 1000,
      updatedAt: 1000,
    })

    const { result, rerender } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current).not.toBeUndefined()

    act(() => {
      sendEvent('plan:p1', null, 'delete')
    })

    rerender()
    expect(result.current).toBeUndefined()
    transport.close()
  })

  it('close() disconnects the EventSource', async () => {
    const transport = createSSETransport('/api/crux/events')
    await new Promise((r) => setTimeout(r, 10))

    transport.close()
    expect(mockInstance!.close).toHaveBeenCalled()
    expect(transport.readyState).toBe('closed')
  })

  it('ignores malformed events', async () => {
    const transport = createSSETransport('/api/crux/events')
    await new Promise((r) => setTimeout(r, 10))

    const listener = mockInstance!.listeners.get('data-crux')
    // Send invalid JSON — should not throw
    listener!(new MessageEvent('data-crux', { data: 'not json' }))

    const { result } = renderHook(() => usePlan('p1'), {
      wrapper: createWrapper(transport),
    })
    expect(result.current).toBeUndefined()
    transport.close()
  })
})
