import { describe, expect, it } from 'vitest'
import {
  CANONICAL_OPTIONS_PARITY_CASES,
  createCanonicalOptionsFixture,
} from './options-parity-fixtures'

describe('adapter options parity scaffold', () => {
  it('builds the shared canonical options fixture for future adapter suites', () => {
    const options = createCanonicalOptionsFixture()

    expect(options.model).toBe('fixture-model')
    expect(options.reasoning).toBe('medium')
    expect(options.timeout).toMatchObject({ totalMs: 30_000, stepMs: 10_000 })
    expect(options.toolApproval).toMatchObject({
      search: 'always',
      '*': 'never',
    })
    expect(options.extra).toMatchObject({
      providerRequestId: 'provider_req_1',
    })
  })

  for (const parityCase of CANONICAL_OPTIONS_PARITY_CASES) {
    it(`Phase ${parityCase.phase}: ${parityCase.name}`, async () => {
      const options = createCanonicalOptionsFixture()

      switch (parityCase.phase) {
        case 2:
          expect(options.reasoning).toBe('medium')
          expect(options.extra).not.toHaveProperty('reasoning')
          break

        case 3:
          expect(options.timeout).toMatchObject({
            totalMs: 30_000,
            stepMs: 10_000,
            chunkMs: 2_000,
            toolMs: 5_000,
            tools: { search: 1_000 },
          })
          expect(options).not.toHaveProperty('timeoutMs')
          break

        case 6:
          expect(options.toolApproval).toEqual({
            search: 'always',
            '*': 'never',
          })
          break

        case 7: {
          const search = options.tools.search as {
            readonly contextSchema?: { safeParse(input: unknown): unknown }
          }

          expect(
            search.contextSchema?.safeParse(options.toolsContext.search),
          ).toMatchObject({ success: true })
          expect(options.runtimeContext).toMatchObject({ requestId: 'req_1' })
          break
        }

        case 9: {
          const providerParams = {
            model: options.model,
            settings: {
              reasoning: options.reasoning,
              maxTokens: options.maxTokens,
            },
          }
          const response = await options.transport(providerParams, {
            stepIndex: 0,
            modelId: options.model,
            signal: options.abortSignal,
          })

          expect(response).toEqual({
            params: providerParams,
            info: {
              stepIndex: 0,
              modelId: 'fixture-model',
              signal: options.abortSignal,
            },
          })
          break
        }
      }
    })
  }
})
