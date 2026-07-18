/** Adapter parity for canonical input media safety boundaries. */

import { describe, expect, it } from 'vitest'
import { GuardrailBlockedError, SafetyResultError } from '../../src/safety'
import {
  runMediaPath,
  type MediaExecutionPath,
  type MediaPathResult,
  type MediaScenario,
} from './media-safety-parity-fixture'

const PATHS = ['generate-core', 'generate-sdk', 'stream-core', 'stream-sdk'] as const

describe('adapter media safety parity', () => {
  it.each(['allow', 'strip', 'report-strip'] as const)(
    'keeps %s behavior identical across core/SDK generate/stream paths',
    async (scenario) => {
      const results = await runAll(scenario)

      for (const result of results) {
        expect(result.callbackCount, result.path).toBe(1)
        expect(result.callbackSawRawSource, result.path).toBe(true)
        expect(result.providerMessages, result.path).toHaveLength(1)
        expect(result.error, result.path).toBeUndefined()
        expect(mediaPartTypes(result.providerMessages[0]!), result.path).toEqual(
          scenario === 'strip' ? ['text'] : ['text', 'image'],
        )
        expect(result.normalizationReads, result.path).toBe(scenario === 'strip' ? 0 : 1)
        expect(result.events, result.path).toEqual(
          scenario === 'strip' ? ['guard', 'provider'] : ['guard', 'normalize', 'provider'],
        )
        expect(result.audit?.applied, result.path).toHaveLength(1)
        expect(result.audit?.applied[0], result.path).toMatchObject({
          guard: `media-${scenario}`,
          boundary: 'user.input.media',
          mode: scenario === 'report-strip' ? 'report' : 'enforce',
          action: scenario === 'allow' ? 'allow' : 'strip',
          location: {
            origin: { kind: 'message', messageIndex: 0, partIndex: 1 },
            partType: 'image',
          },
        })
        expect(mediaPartTypes(result.resultMessages?.slice(0, 1) ?? []), result.path).toEqual(
          scenario === 'strip' ? ['text'] : ['text', 'image'],
        )
      }

      expect(results.map((result) => stableAudit(result))).toEqual(
        Array.from({ length: PATHS.length }, () => stableAudit(results[0]!)),
      )
    },
  )

  it.each([
    ['block', GuardrailBlockedError],
    ['invalid', SafetyResultError],
  ] as const)('stops every provider path for a %s media result', async (scenario, ErrorType) => {
    const results = await runAll(scenario)

    for (const result of results) {
      expect(result.callbackCount, result.path).toBe(1)
      expect(result.callbackSawRawSource, result.path).toBe(true)
      expect(result.providerMessages, result.path).toHaveLength(0)
      expect(result.normalizationReads, result.path).toBe(0)
      expect(result.events, result.path).toEqual(['guard'])
      expect(result.error, result.path).toBeInstanceOf(ErrorType)
    }
  })
})

async function runAll(scenario: MediaScenario): Promise<readonly MediaPathResult[]> {
  return Promise.all(PATHS.map((path) => runMediaPath(path, scenario)))
}

function stableAudit(result: MediaPathResult) {
  return result.audit
    ? {
        ...result.audit,
        applied: result.audit.applied.map(({ durationMs: _durationMs, ...entry }) => entry),
      }
    : undefined
}

function mediaPartTypes(messages: readonly { readonly content: unknown }[]): string[] {
  return messages.flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as ReadonlyArray<{ readonly type: string }>).map((part) => part.type)
      : [],
  )
}
