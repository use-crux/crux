import { afterEach, describe, expect, it } from 'vitest'
import { config, type CruxConfig } from '../../src'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
} from '../../src/observability'
import {
  createRuntimeConfigTransaction,
  planRuntimeConfig,
} from '../../src/runtime/config-transaction'
import { getHooks, resetHooks, updateHooks } from '../../src/runtime/runtime'

describe('observability redaction config', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('rejects default and custom replacements changed by the complete rule set', () => {
    expect(() =>
      config({
        observability: {
          redactPatterns: [/REDACTED/],
        },
      }),
    ).toThrow(TypeError)

    expect(() =>
      config({
        observability: {
          redactPatterns: [
            { pattern: /secret/, replacement: 'TOKEN' },
            /TOKEN/,
          ],
        },
      }),
    ).toThrow(TypeError)
  })

  it.each([
    {
      value: /SECRET-SOURCE/,
      message: 'observability.redactPatterns must be an array',
    },
    {
      value: ['SECRET-ENTRY'],
      message:
        'observability.redactPatterns[0] must be a RegExp or pattern object',
    },
    {
      value: [null],
      message:
        'observability.redactPatterns[0] must be a RegExp or pattern object',
    },
    {
      value: [{}],
      message: 'observability.redactPatterns[0].pattern must be a RegExp',
    },
    {
      value: [{ pattern: 'SECRET-SOURCE' }],
      message: 'observability.redactPatterns[0].pattern must be a RegExp',
    },
    {
      value: [{ pattern: /SECRET-SOURCE/, replacement: 42 }],
      message: 'observability.redactPatterns[0].replacement must be a string',
    },
  ])('rejects malformed runtime config with content-free errors', ({
    value,
    message,
  }) => {
    expect(installInvalid(value)).toThrowError(new TypeError(message))

    try {
      installInvalid(value)()
    } catch (error) {
      expect(String(error)).not.toContain('SECRET')
    }
  })

  it('plans only capture fields with a private frozen snapshot', () => {
    const callerPatterns = [/ACME-\d+/]
    const plan = planRuntimeConfig({
      config: {
        observability: {
          enabled: true,
          token: 'not-a-capture-field',
          redactPatterns: callerPatterns,
        },
      },
    })
    const policy = plan.hooksPatch.observabilityCapture

    expect(policy).toEqual({
      redactPatterns: [expect.any(RegExp)],
    })
    expect(policy?.redactPatterns).not.toBe(callerPatterns)
    expect(policy?.redactPatterns?.[0]).not.toBe(callerPatterns[0])
    expect(Object.isFrozen(policy?.redactPatterns)).toBe(true)
    expect(plan.ownsObservability).toBe(false)
  })

  it('keeps an empty list as an explicit frozen no-op without a transport', () => {
    const runtime = config({
      observability: {
        redactPatterns: [],
      },
    })

    try {
      expect(getHooks().observabilityCapture).toEqual({
        redactPatterns: [],
      })
      expect(
        Object.isFrozen(getHooks().observabilityCapture?.redactPatterns),
      ).toBe(true)
      expect(getHooks().observabilityTransport).toBeUndefined()
    } finally {
      runtime.dispose()
    }
  })

  it('throws during planning before any effect port can run', () => {
    let effectCalls = 0
    expect(() =>
      createRuntimeConfigTransaction(
        {
          config: {
            observability: {
              redactPatterns: 'SECRET' as never,
            },
          },
        },
        {
          hooks: {
            get: () => {
              effectCalls += 1
              return {}
            },
            set: () => {
              effectCalls += 1
            },
            update: () => {
              effectCalls += 1
            },
            pushLayer: () => {
              effectCalls += 1
              return {} as never
            },
            restoreLayer: () => {
              effectCalls += 1
            },
          },
        },
      ),
    ).toThrow(TypeError)
    expect(effectCalls).toBe(0)
  })

  it('keeps the installed snapshot across emissions and caller mutation', async () => {
    const entry = {
      pattern: /ACME-\d+/,
      replacement: '[identifier]',
    }
    const callerPatterns = [entry]
    const transport = createInMemoryObservabilityTransport()
    const runtime = config({
      observability: {
        transport,
        redactPatterns: callerPatterns,
      },
    })
    const snapshot = getHooks().observabilityCapture?.redactPatterns

    callerPatterns[0] = { pattern: /OTHER-\d+/, replacement: '[other]' }
    callerPatterns.push({ pattern: /THIRD-\d+/, replacement: '[third]' })
    try {
      await emitArtifact('ACME-100001')
      expect(getHooks().observabilityCapture?.redactPatterns).toBe(snapshot)
      await emitArtifact('ACME-100002')
      expect(getHooks().observabilityCapture?.redactPatterns).toBe(snapshot)
      await observe.flush()

      expect(JSON.stringify(transport.records)).not.toContain('ACME-')
      expect(JSON.stringify(transport.records)).toContain('[identifier]')
    } finally {
      runtime.dispose()
    }
  })

  it('replaces active config snapshots and restores the prior hook policy', () => {
    const previousPatterns = [/PREVIOUS-\d+/]
    updateHooks({
      observabilityCapture: {
        redactPatterns: previousPatterns,
      },
    })
    const first = config({
      observability: { redactPatterns: [/FIRST-\d+/] },
    })
    const firstSnapshot = getHooks().observabilityCapture?.redactPatterns
    const second = config({
      observability: { redactPatterns: [/SECOND-\d+/] },
    })
    const secondSnapshot = getHooks().observabilityCapture?.redactPatterns

    expect(secondSnapshot).not.toBe(firstSnapshot)
    expect(secondSnapshot?.[0]).toMatchObject({ source: 'SECOND-\\d+' })
    second.dispose()
    expect(getHooks().observabilityCapture?.redactPatterns).toBe(
      previousPatterns,
    )

    first.dispose()
  })

  it('does not plan a policy when every capture field is absent', () => {
    const plan = planRuntimeConfig({
      config: { observability: { enabled: true } },
    })

    expect(plan.hooksPatch.observabilityCapture).toBeUndefined()
  })
})

function installInvalid(value: unknown): () => unknown {
  return () =>
    config({
      observability: {
        redactPatterns: value,
      },
    } as unknown as CruxConfig)
}

async function emitArtifact(preview: string): Promise<void> {
  await observe.run(
    { name: 'config snapshot test', rootPrimitive: 'custom.operation' },
    async () => {
      observe.artifact({
        kind: 'output',
        contentType: 'text/plain',
        encoding: 'text',
        preview,
      })
    },
  )
}
