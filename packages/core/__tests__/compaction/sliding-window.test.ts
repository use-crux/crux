import { describe, it, expect } from 'vitest'
import { createSlidingWindow } from '../../compaction/sliding-window'
import { inMemoryCruxStore as inMemoryStore } from '../../store/memory'
import type { Message } from '../../generation/messages'
import type { GenerateTextFn } from '../../compaction/types'

function msg(role: Message['role'], content: string): Message {
  return { role, content }
}

/** Mock generate that returns a fixed summary. */
const mockGenerate: GenerateTextFn = async () => ({
  text: 'Summary of earlier messages.',
})

describe('createSlidingWindow', () => {
  it('returns empty messages when nothing pushed', async () => {
    const window = createSlidingWindow({
      windowSize: 5,
      generate: mockGenerate,
      model: 'test',
    })

    const messages = await window.getMessages()
    expect(messages).toEqual([])
  })

  it('returns pushed messages within window size', async () => {
    const window = createSlidingWindow({
      windowSize: 5,
      generate: mockGenerate,
      model: 'test',
    })

    await window.push(msg('user', 'Hello'))
    await window.push(msg('assistant', 'Hi there'))

    const messages = await window.getMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('Hello')
    expect(messages[1].content).toBe('Hi there')
  })

  it('does not produce summary when within window', async () => {
    const window = createSlidingWindow({
      windowSize: 5,
      generate: mockGenerate,
      model: 'test',
    })

    await window.push(msg('user', 'Hello'))
    await window.push(msg('assistant', 'Hi'))

    const messages = await window.getMessages()
    // No summary message — all fit in window
    expect(messages.every((m) => m.role !== 'system')).toBe(true)
  })

  it('triggers compaction when window overflows', async () => {
    const window = createSlidingWindow({
      windowSize: 2,
      generate: mockGenerate,
      model: 'test',
    })

    await window.push(msg('user', 'Message 1'))
    await window.push(msg('assistant', 'Response 1'))
    await window.push(msg('user', 'Message 2'))

    const messages = await window.getMessages()
    // Should have summary + 2 windowed messages
    expect(messages).toHaveLength(3)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Summary')
  })

  it('keeps exactly windowSize recent messages after compaction', async () => {
    const window = createSlidingWindow({
      windowSize: 2,
      generate: mockGenerate,
      model: 'test',
    })

    await window.push(msg('user', 'Old 1'))
    await window.push(msg('assistant', 'Old 2'))
    await window.push(msg('user', 'Recent 1'))
    await window.push(msg('assistant', 'Recent 2'))

    const messages = await window.getMessages()
    const nonSystem = messages.filter((m) => m.role !== 'system')
    expect(nonSystem).toHaveLength(2)
    expect(nonSystem[0].content).toBe('Recent 1')
    expect(nonSystem[1].content).toBe('Recent 2')
  })

  it('tracks stats correctly', async () => {
    const window = createSlidingWindow({
      windowSize: 2,
      generate: mockGenerate,
      model: 'test',
    })

    expect(window.getStats().totalMessages).toBe(0)
    expect(window.getStats().evictions).toBe(0)

    await window.push(msg('user', 'One'))
    await window.push(msg('assistant', 'Two'))
    expect(window.getStats().totalMessages).toBe(2)
    expect(window.getStats().evictions).toBe(0)

    await window.push(msg('user', 'Three'))
    expect(window.getStats().totalMessages).toBe(3)
    expect(window.getStats().evictions).toBe(1)
    expect(window.getStats().summaryTokens).toBeGreaterThan(0)
  })

  it('calls generate with previous summary on subsequent compactions', async () => {
    let callCount = 0
    let lastPrompt = ''
    const generate: GenerateTextFn = async (opts) => {
      callCount++
      lastPrompt = opts.prompt
      return { text: `Summary v${callCount}` }
    }

    const window = createSlidingWindow({
      windowSize: 1,
      generate,
      model: 'test',
    })

    // First overflow: 2 messages → compacts 1, keeps 1
    await window.push(msg('user', 'First'))
    await window.push(msg('assistant', 'Second'))
    expect(callCount).toBe(1)

    // Second overflow: compacts with previous summary
    await window.push(msg('user', 'Third'))
    expect(callCount).toBe(2)
    expect(lastPrompt).toContain('Summary v1')
  })

  it('uses provided MemoryStore for persistence', async () => {
    const store = inMemoryStore()
    const window = createSlidingWindow({
      windowSize: 2,
      generate: mockGenerate,
      model: 'test',
      store,
    })

    await window.push(msg('user', 'Hello'))
    await window.push(msg('assistant', 'Hi'))

    // Verify data is in the store
    const entry = await store.get('compact:default:messages')
    expect(entry).not.toBeNull()
    expect(entry!.content).toContain('Hello')
  })

  it('uses custom id for store keys', async () => {
    const store = inMemoryStore()
    const window = createSlidingWindow({
      windowSize: 5,
      generate: mockGenerate,
      model: 'test',
      store,
      id: 'my-window',
    })

    await window.push(msg('user', 'Hello'))

    const entry = await store.get('compact:my-window:messages')
    expect(entry).not.toBeNull()
  })

  it('passes model to generate function', async () => {
    let capturedModel: unknown
    const generate: GenerateTextFn = async (opts) => {
      capturedModel = opts.model
      return { text: 'summary' }
    }

    const window = createSlidingWindow({
      windowSize: 1,
      generate,
      model: 'special-model',
    })

    await window.push(msg('user', 'First'))
    await window.push(msg('assistant', 'Second'))

    expect(capturedModel).toBe('special-model')
  })

  it('handles window size of 1', async () => {
    const window = createSlidingWindow({
      windowSize: 1,
      generate: mockGenerate,
      model: 'test',
    })

    await window.push(msg('user', 'Only one'))
    let messages = await window.getMessages()
    expect(messages).toHaveLength(1)

    await window.push(msg('assistant', 'Replying'))
    messages = await window.getMessages()
    expect(messages).toHaveLength(2) // summary + 1 recent
    expect(messages[0].role).toBe('system')
  })

  it('handles rapid sequential pushes', async () => {
    const window = createSlidingWindow({
      windowSize: 3,
      generate: mockGenerate,
      model: 'test',
    })

    for (let i = 0; i < 10; i++) {
      await window.push(msg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`))
    }

    const messages = await window.getMessages()
    const nonSystem = messages.filter((m) => m.role !== 'system')
    expect(nonSystem).toHaveLength(3)
    expect(window.getStats().totalMessages).toBe(10)
    expect(window.getStats().evictions).toBe(7)
  })
})
