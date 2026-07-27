/** Semantic-cache queries use approved provider input by default. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSemanticCache } from '../../src/cache'
import { resolveQueryText } from '../../src/cache/query'
import { orchestrateGenerate } from '../../src/generation/orchestrate'
import {
  attachCachedCandidateFinalizer,
  cachedCandidateFinalizer,
  finalizeCachedCandidate,
  readCachedCandidateFinalizer,
} from '../../src/runtime/internal/cached-candidate-finalizer'
import { resetHooks } from '../../src/runtime/runtime'
import type { PromptMiddlewareArgs } from '../../src/runtime/types'
import { inMemoryStorage } from '../../src/storage'
import {
  cacheablePrompt,
  denseEmbedding,
  installSemanticCachePlugins,
} from './semantic-cache.fixtures'

afterEach(() => resetHooks())

describe('semantic cache approved query input', () => {
  it('prefers guarded prepared input over raw resolved content', async () => {
    const args = {
      promptId: 'approved-query',
      input: { message: 'RAW_INPUT' },
      preparedArgs: {
        system: 'APPROVED_SYSTEM',
        messages: [{ role: 'user', content: 'APPROVED_MESSAGE' }],
      },
      resolved: {
        system: 'RAW_SYSTEM',
        prompt: 'RAW_PROMPT',
        messages: [{ role: 'user', content: 'RAW_MESSAGE' }],
      },
    } as PromptMiddlewareArgs

    const query = await resolveQueryText(
      { mode: 'readwrite', version: 'v1' },
      args,
    )

    expect(query).toContain('APPROVED_SYSTEM')
    expect(query).toContain('APPROVED_MESSAGE')
    expect(query).not.toContain('RAW_SYSTEM')
    expect(query).not.toContain('RAW_PROMPT')
    expect(query).not.toContain('RAW_MESSAGE')
    expect(query).not.toContain('RAW_INPUT')
  })

  it('preserves the documented raw context for a custom query callback', async () => {
    const query = vi.fn(({ input, resolved }) =>
      [
        String(input.message),
        resolved.system,
        resolved.prompt,
        String(resolved.messages?.[0]?.content),
      ].join('|'),
    )
    const args = {
      promptId: 'custom-query',
      input: { message: 'RAW_INPUT' },
      preparedArgs: {
        system: 'APPROVED_SYSTEM',
        messages: [{ role: 'user', content: 'APPROVED_MESSAGE' }],
      },
      resolved: {
        system: 'RAW_SYSTEM',
        prompt: 'RAW_PROMPT',
        messages: [{ role: 'user', content: 'RAW_MESSAGE' }],
      },
    } as PromptMiddlewareArgs

    const value = await resolveQueryText(
      { mode: 'readwrite', version: 'v1', query },
      args,
    )

    expect(value).toBe('RAW_INPUT|RAW_SYSTEM|RAW_PROMPT|RAW_MESSAGE')
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      input: { message: 'RAW_INPUT' },
      resolved: { system: 'RAW_SYSTEM', prompt: 'RAW_PROMPT' },
      preparedArgs: {
        system: 'APPROVED_SYSTEM',
        messages: [{ role: 'user', content: 'APPROVED_MESSAGE' }],
      },
    })
  })

  it('discovers and awaits a finalizer during middleware cache lookup', async () => {
    installSemanticCachePlugins(
      {
        name: 'inner-pass-through',
        install: () => ({
          middleware: async (args, next) => next(args),
        }),
      },
      createSemanticCache({
        storage: inMemoryStorage(),
        embedding: denseEmbedding(),
        ttl: 60_000,
        scope: 'global',
      }),
    )
    const prompt = cacheablePrompt()
    const input = { message: 'billing help', userId: 'u1' }
    const finalizer = vi.fn(async (candidate) => {
      await Promise.resolve()
      return {
        kind: 'accept' as const,
        result: { ...candidate, object: { intent: 'approved-cache' } },
      }
    })
    const spec = attachCachedCandidateFinalizer(
      {
        promptId: prompt.id,
        promptConfig: prompt.config,
        preparedArgs: { input },
        input,
        model: 'mock',
        resolved: await prompt.resolve({ input }),
        outputMode: 'object' as const,
      },
      finalizer,
    )
    const generate = vi.fn(async () => ({
      object: { intent: 'provider' },
      _meta: { finishReason: 'stop' as const },
    }))

    await orchestrateGenerate(spec, generate)
    const cached = await orchestrateGenerate(spec, generate)

    expect(generate).toHaveBeenCalledOnce()
    expect(finalizer).toHaveBeenCalledOnce()
    expect(finalizer.mock.calls[0]?.[0]).toMatchObject({
      object: { intent: 'provider' },
      _meta: { semanticCache: { hit: true } },
    })
    expect(cached.object).toEqual({ intent: 'approved-cache' })
  })

  it('accepts candidates unchanged when no finalizer capability exists', async () => {
    const candidate = { text: 'provider-neutral' }

    const decision = await finalizeCachedCandidate(
      async () => candidate,
      candidate,
    )

    expect(decision).toEqual({ kind: 'accept', result: candidate })
    expect(decision.kind === 'accept' && decision.result).toBe(candidate)
  })

  it('keeps finalizer capability metadata non-enumerable and unserialized', () => {
    const carrier = {}
    const finalizer = vi.fn(async (candidate) => ({
      kind: 'accept' as const,
      result: candidate,
    }))

    attachCachedCandidateFinalizer(carrier, finalizer)

    expect(readCachedCandidateFinalizer(carrier)).toBe(finalizer)
    expect(
      Object.getOwnPropertyDescriptor(carrier, cachedCandidateFinalizer),
    ).toMatchObject({ enumerable: false })
    expect(Object.keys(carrier)).toEqual([])
    expect(JSON.stringify(carrier)).toBe('{}')
  })
})
