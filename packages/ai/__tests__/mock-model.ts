/**
 * `MockLanguageModelV3` builders with correct V3 result shapes
 * (structured `finishReason: { unified, raw }`, nested usage).
 * Shared by loop-fidelity and conformance tests.
 */

import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModel } from 'ai'

export interface MockEmission {
  text?: string
  toolCalls?: ReadonlyArray<{ id?: string; name: string; args?: unknown }>
}

function v3Result(emission: MockEmission, sequence: number) {
  const content: Array<Record<string, unknown>> = []
  if (emission.text) content.push({ type: 'text', text: emission.text })
  for (const [index, tc] of (emission.toolCalls ?? []).entries()) {
    content.push({
      type: 'tool-call',
      toolCallId: tc.id ?? `tc_${sequence}_${index}`,
      toolName: tc.name,
      input: JSON.stringify(tc.args ?? {}),
    })
  }
  return {
    content,
    finishReason: {
      unified: (emission.toolCalls?.length ? 'tool-calls' : 'stop') as 'tool-calls' | 'stop',
      raw: undefined,
    },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 7, text: 7, reasoning: undefined },
    },
    warnings: [],
  }
}

/** A V3 mock model that replays the scripted step emissions in order. */
export function emissionModel(emissions: readonly MockEmission[]): LanguageModel {
  const queue = [...emissions]
  let sequence = 0
  return new MockLanguageModelV3({
    doGenerate: async () => v3Result(queue.shift() ?? { text: 'exhausted' }, sequence++) as never,
  }) as unknown as LanguageModel
}

/** A V3 mock model that replays raw structured-output texts in order. */
export function structuredModel(texts: readonly string[]): LanguageModel {
  const queue = [...texts]
  let sequence = 0
  return new MockLanguageModelV3({
    doGenerate: async () => v3Result({ text: queue.shift() ?? '{}' }, sequence++) as never,
  }) as unknown as LanguageModel
}
