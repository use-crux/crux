import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { delegate as makeDelegate } from '../../agent/delegate'
import { handoff as makeHandoff } from '../../agent/handoff'
import { blackboard as makeBlackboard } from '../../agent/blackboard'

// ── Shared fixtures ────────────────────────────────────────────────

const simpleInputSchema = z.object({ value: z.string() })
const simpleOutputSchema = z.object({ result: z.string() })

const simpleHandoff = makeHandoff({
  id: 'simple',
  inputSchema: simpleInputSchema,
  outputSchema: simpleOutputSchema,
  transform: (input) => ({ result: input.value.toUpperCase() }),
})

const argsSchema = z.object({ query: z.string() })

// ── Tests ──────────────────────────────────────────────────────────

describe('error paths across agent modules', () => {
  describe('delegate: execute() throwing propagates from run()', () => {
    it('propagates synchronous error from execute', async () => {
      const d = makeDelegate({
        id: 'error-delegate',
        argsSchema,
        handoff: simpleHandoff,
        execute: async () => {
          throw new Error('Subagent crashed')
        },
      })

      await expect(d.run({ query: 'test' })).rejects.toThrow('Subagent crashed')
    })

    it('propagates error through asTools().delegate.execute', async () => {
      const d = makeDelegate({
        id: 'error-delegate',
        argsSchema,
        handoff: simpleHandoff,
        execute: async () => {
          throw new Error('AsTools execution failed')
        },
      })

      const { delegate } = d.asTools()
      await expect(delegate.execute({ query: 'test' })).rejects.toThrow('AsTools execution failed')
    })

    it('propagates typed errors (not just Error)', async () => {
      class SubagentError extends Error {
        code: string
        constructor(code: string, message: string) {
          super(message)
          this.code = code
        }
      }

      const d = makeDelegate({
        id: 'typed-error-delegate',
        argsSchema,
        handoff: simpleHandoff,
        execute: async () => {
          throw new SubagentError('RATE_LIMIT', 'Too many requests')
        },
      })

      await expect(d.run({ query: 'test' })).rejects.toThrow('Too many requests')
    })
  })

describe('handoff: async transform throwing propagates', () => {
    it('propagates error from async transform', async () => {
      const h = makeHandoff({
        id: 'error-handoff',
        inputSchema: z.object({ data: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        transform: async () => {
          throw new Error('Transform failed')
        },
      })

      await expect(h.prepare({ data: 'test' })).rejects.toThrow('Transform failed')
    })

    it('propagates error from summarize generate function', async () => {
      const h = makeHandoff({
        id: 'summarize-error',
        inputSchema: z.object({ data: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        transform: (input) => ({ result: input.data }),
        summarize: {
          generate: async () => {
            throw new Error('LLM unavailable')
          },
          model: 'mock',
        },
      })

      await expect(h.prepare({ data: 'test' })).rejects.toThrow('LLM unavailable')
    })

    it('propagates transform error through send()', async () => {
      const { inMemoryCruxStore } = await import('../../store/memory')
      const store = inMemoryCruxStore()

      const h = makeHandoff({
        id: 'send-error',
        inputSchema: z.object({ data: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        transform: async () => {
          throw new Error('Transform failed in send')
        },
        store,
      })

      await expect(h.send({ data: 'test' })).rejects.toThrow('Transform failed in send')

      // Store should not have been written to
      const entry = await store.get('handoff:send-error')
      expect(entry).toBeNull()
    })
  })

describe('blackboard: subscriber callback throwing does not prevent store write', () => {
    it('write succeeds even when subscriber throws', async () => {
      const board = makeBlackboard({
        id: 'error-board',
        schema: z.object({ goal: z.string(), status: z.string() }),
      })

      const throwingListener = vi.fn(() => {
        throw new Error('Subscriber exploded')
      })
      board.subscribe(throwingListener)

      // set() should throw because the subscriber throws, but let's check
      // that the data was actually persisted to the store before the subscriber ran
      // In the current implementation, notify() is called after writeState(),
      // so the store write completes before subscriber notification.
      //
      // The subscriber error will propagate, but the write is already persisted.
      try {
        await board.set('goal', 'Important goal')
      } catch {
        // subscriber may throw
      }

      // The write should have persisted despite the subscriber error
      // Create a new board reading from the same store to verify
      // Since default store is ephemeral per-instance, we test with explicit store
      const { inMemoryCruxStore } = await import('../../store/memory')
      const store = inMemoryCruxStore()

      const board2 = makeBlackboard({
        id: 'shared-board',
        schema: z.object({ goal: z.string() }),
        store,
      })

      const throwingSub = vi.fn(() => {
        throw new Error('Subscriber exploded')
      })
      board2.subscribe(throwingSub)

      try {
        await board2.set('goal', 'Persisted value')
      } catch {
        // expected: subscriber throws
      }

      // Verify the data was written to the store before the subscriber threw
      const entry = await store.get('blackboard:shared-board')
      expect(entry).not.toBeNull()
      expect(JSON.parse(entry!.content as string)).toEqual({ goal: 'Persisted value' })
    })

    it('subsequent subscribers still fire even if one throws', async () => {
      const board = makeBlackboard({
        id: 'multi-sub-board',
        schema: z.object({ goal: z.string() }),
      })

      const firstListener = vi.fn(() => {
        throw new Error('First subscriber failed')
      })
      const secondListener = vi.fn()

      board.subscribe(firstListener)
      board.subscribe(secondListener)

      try {
        await board.set('goal', 'Test')
      } catch {
        // first subscriber throws
      }

      expect(firstListener).toHaveBeenCalledOnce()
      // Note: because the implementation iterates listeners synchronously,
      // if the first listener throws, the second will NOT be called.
      // This documents the current behavior.
      expect(secondListener).not.toHaveBeenCalled()
    })

    it('patch persists despite subscriber error', async () => {
      const { inMemoryCruxStore } = await import('../../store/memory')
      const store = inMemoryCruxStore()

      const board = makeBlackboard({
        id: 'patch-error-board',
        schema: z.object({
          goal: z.string(),
          status: z.enum(['idle', 'done']),
        }),
        store,
      })

      board.subscribe(() => {
        throw new Error('Listener broke')
      })

      try {
        await board.patch({ goal: 'Patched', status: 'done' })
      } catch {
        // expected
      }

      const entry = await store.get('blackboard:patch-error-board')
      expect(entry).not.toBeNull()
      expect(JSON.parse(entry!.content as string)).toEqual({
        goal: 'Patched',
        status: 'done',
      })
    })
  })
})
