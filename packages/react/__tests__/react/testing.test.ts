// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createMockTransport } from '../../src/testing'
import type { JsonObject } from '@use-crux/core/store'

// ── useDocument ──

describe('createMockTransport — useDocument', () => {
  it('returns undefined for a missing key', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => transport.useDocument('missing-key'))

    // Missing key returns null (loaded, not found)
    expect(result.current).toBeNull()
  })

  it('returns undefined when key is undefined (skip)', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => transport.useDocument(undefined))

    expect(result.current).toBeUndefined()
  })

  it('returns value after set', () => {
    const transport = createMockTransport()
    const doc: JsonObject = { id: 'abc', title: 'Hello' }
    transport.set('plan:abc', doc)

    const { result } = renderHook(() => transport.useDocument('plan:abc'))

    expect(result.current).toEqual({ id: 'abc', title: 'Hello' })
  })

  it('returns null after delete', () => {
    const transport = createMockTransport()
    const doc: JsonObject = { id: 'abc', title: 'Hello' }
    transport.set('plan:abc', doc)

    const { result: before } = renderHook(() => transport.useDocument('plan:abc'))
    expect(before.current).toEqual(doc)

    // Now delete and re-render
    const { result } = renderHook(() => {
      return transport.useDocument('plan:abc')
    })

    act(() => {
      transport.delete('plan:abc')
    })

    expect(result.current).toBeNull()
  })

  it('set triggers re-render (listener fires)', () => {
    const transport = createMockTransport()
    const renderCount = vi.fn()

    const { result } = renderHook(() => {
      renderCount()
      return transport.useDocument('item:1')
    })

    // Initial render: null (loaded, not found)
    expect(result.current).toBeNull()
    const initialCallCount = renderCount.mock.calls.length

    // Set a value — should trigger re-render
    act(() => {
      transport.set('item:1', { value: 'first' })
    })

    expect(renderCount.mock.calls.length).toBeGreaterThan(initialCallCount)
    expect(result.current).toEqual({ value: 'first' })

    // Update the value — should trigger another re-render
    const afterFirstSetCount = renderCount.mock.calls.length
    act(() => {
      transport.set('item:1', { value: 'second' })
    })

    expect(renderCount.mock.calls.length).toBeGreaterThan(afterFirstSetCount)
    expect(result.current).toEqual({ value: 'second' })
  })
})

// ── useDocumentList ──

describe('createMockTransport — useDocumentList', () => {
  it('returns matching entries by prefix', () => {
    const transport = createMockTransport()
    transport.set('task:list-1:t1', { id: 't1', label: 'First' })
    transport.set('task:list-1:t2', { id: 't2', label: 'Second' })
    transport.set('task:list-2:t3', { id: 't3', label: 'Other list' })
    transport.set('plan:abc', { id: 'abc', title: 'Plan' })

    const { result } = renderHook(() => transport.useDocumentList('task:list-1:'))

    expect(result.current).toBeDefined()
    expect(result.current).toHaveLength(2)
    expect(result.current!.map((e) => e.key).sort()).toEqual(['task:list-1:t1', 'task:list-1:t2'])
  })

  it('returns undefined when prefix is undefined (skip)', () => {
    const transport = createMockTransport()
    transport.set('task:list-1:t1', { id: 't1' })

    const { result } = renderHook(() => transport.useDocumentList(undefined))

    expect(result.current).toBeUndefined()
  })

  it('returns empty array when no entries match prefix', () => {
    const transport = createMockTransport()
    transport.set('plan:abc', { id: 'abc' })

    const { result } = renderHook(() => transport.useDocumentList('task:'))

    expect(result.current).toBeDefined()
    expect(result.current).toHaveLength(0)
  })

  it('supports filter option for narrowing results', () => {
    const transport = createMockTransport()
    transport.set('tasklist:l1', { id: 'l1', planId: 'plan-1' })
    transport.set('tasklist:l2', { id: 'l2', planId: 'plan-2' })

    const { result } = renderHook(() => transport.useDocumentList('tasklist:', { filter: { planId: 'plan-1' } }))

    expect(result.current).toBeDefined()
    expect(result.current).toHaveLength(1)
    expect(result.current![0].value).toEqual({ id: 'l1', planId: 'plan-1' })
  })

  it('reflects changes when entries are added', () => {
    const transport = createMockTransport()

    const { result } = renderHook(() => transport.useDocumentList('task:list-1:'))

    expect(result.current).toHaveLength(0)

    act(() => {
      transport.set('task:list-1:t1', { id: 't1', label: 'New task' })
    })

    expect(result.current).toHaveLength(1)
    expect(result.current![0].key).toBe('task:list-1:t1')
  })
})

// ── getData ──

describe('createMockTransport — getData', () => {
  it('exposes the raw data map for assertions', () => {
    const transport = createMockTransport()
    transport.set('key-1', { a: 1 })
    transport.set('key-2', { b: 2 })

    const data = transport.getData()

    expect(data).toBeInstanceOf(Map)
    expect(data.size).toBe(2)
    expect(data.get('key-1')).toEqual({ a: 1 })
  })

  it('reflects deletions in the raw data map', () => {
    const transport = createMockTransport()
    transport.set('key-1', { a: 1 })
    transport.delete('key-1')

    expect(transport.getData().size).toBe(0)
  })
})
