/**
 * Local behavioral harness for the Google adapter's normalized-outcome suite.
 *
 * Drives the real `createGoogle(...)` generate/stream surface with small
 * scripted GoogleGenAI clients and projects each run into the provider-neutral
 * snapshot shape from `@use-crux/core/adapter/testing`. Google has a distinct
 * content-filter stop reason (`SAFETY`) but no distinct refusal signal, so the
 * harness supplies `contentFilter` and omits `refusal`.
 *
 * @module
 */

import type { GoogleGenAI } from '@google/genai'
import { prompt as makePrompt } from '@use-crux/core'
import { isCruxAdapterError } from '@use-crux/core/adapter'
import type { CruxFinishReason } from '@use-crux/core/adapter'
import type {
  NormalizedErrorSnapshot,
  NormalizedOutcomeBehavioralHarness,
  NormalizedResultSnapshot,
  NormalizedStreamErrorSnapshot,
} from '@use-crux/core/adapter/testing'
import { createGoogle } from '../src'

const textPrompt = makePrompt({ id: 'google-behavior', prompt: 'Hi' })

/** GoogleGenAI `generateContent` signature the adapter actually calls. */
type GenerateFn = (request?: unknown) => unknown

/** Build a client from a `generateContent` and/or `generateContentStream` pair. */
function client(members: {
  generateContent?: GenerateFn
  generateContentStream?: () => unknown
}): GoogleGenAI {
  return { models: members } as unknown as GoogleGenAI
}

/** A non-streaming response with the given finish reason. */
function response(finishReason: string): unknown {
  return {
    text: 'hello',
    modelVersion: 'gemini-actual',
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
    candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] }, finishReason }],
  }
}

/** A stream that emits text then finalizes with a completed function call. */
async function* toolCallStream(): AsyncIterable<unknown> {
  for (const text of ['he', 'llo']) {
    yield { candidates: [{ content: { role: 'model', parts: [{ text }] } }] }
  }
  yield {
    modelVersion: 'gemini-actual',
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
    candidates: [
      {
        content: { role: 'model', parts: [{ functionCall: { id: 'call_1', name: 'lookup', args: { q: 'x' } } }] },
        finishReason: 'FUNCTION_CALL',
      },
    ],
  }
}

/** A stream that yields one delta then fails mid-flight. */
async function* erroringStream(): AsyncIterable<unknown> {
  yield { candidates: [{ content: { role: 'model', parts: [{ text: 'partial' }] } }] }
  throw new Error('connection reset')
}

/** Await a rejecting promise and project its normalized provider error. */
async function errorSnapshot(promise: Promise<unknown>): Promise<NormalizedErrorSnapshot> {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    if (!isCruxAdapterError(error)) throw error
    return { kind: error.providerError.kind, retryable: error.providerError.retryable }
  }
}

/** The Google behavioral harness bound to the shared conformance contract. */
export function googleBehavioralHarness(): NormalizedOutcomeBehavioralHarness {
  const resultOf = async (finishReason: string): Promise<NormalizedResultSnapshot> => {
    const result = await createGoogle(client({ generateContent: async () => response(finishReason) }), {
      cachedContent: false,
    }).generate(textPrompt, { model: 'gemini' })
    return { finishReason: result.finalStep.finishReason as CruxFinishReason }
  }

  return {
    generateSuccess: () => resultOf('STOP'),
    streamCompletedToolCall: async (): Promise<NormalizedResultSnapshot> => {
      const handle = await createGoogle(client({ generateContentStream: async () => toolCallStream() }), {
        cachedContent: false,
      }).stream(textPrompt, { model: 'gemini' })
      for await (const _ of handle.textStream) void _
      const completed = await handle.completion
      return {
        finishReason: completed.finalStep.finishReason as CruxFinishReason,
        toolCalls: completed.finalStep.toolCalls,
      }
    },
    contentFilter: () => resultOf('SAFETY'),
    timeout: () =>
      errorSnapshot(
        createGoogle(client({ generateContent: () => new Promise<never>(() => {}) }), {
          cachedContent: false,
        }).generate(textPrompt, { model: 'gemini', timeout: { stepMs: 20 } }),
      ),
    userAbort: () => {
      const controller = new AbortController()
      controller.abort()
      const generateContent: GenerateFn = async () => {
        const err = new Error('Request was aborted.')
        err.name = 'AbortError'
        throw err
      }
      return errorSnapshot(
        createGoogle(client({ generateContent }), { cachedContent: false }).generate(textPrompt, {
          model: 'gemini',
          signal: controller.signal,
        }),
      )
    },
    erroringStream: async (): Promise<NormalizedStreamErrorSnapshot> => {
      const handle = await createGoogle(client({ generateContentStream: async () => erroringStream() }), {
        cachedContent: false,
      }).stream(textPrompt, { model: 'gemini' })
      const iteration = await errorSnapshot(
        (async () => {
          for await (const _ of handle.textStream) void _
        })(),
      )
      const completion = await errorSnapshot(handle.completion)
      return { iteration, completion }
    },
  }
}
