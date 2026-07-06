import { describe, expect, it } from 'vitest'
import { CANONICAL_OPTIONS_PARITY_CASES, createCanonicalOptionsFixture } from './options-parity-fixtures'

describe('adapter options parity scaffold', () => {
  it('builds the shared canonical options fixture for future adapter suites', () => {
    const options = createCanonicalOptionsFixture()

    expect(options.model).toBe('fixture-model')
    expect(options.reasoning).toBe('medium')
    expect(options.timeout).toMatchObject({ totalMs: 30_000, stepMs: 10_000 })
    expect(options.toolApproval).toMatchObject({ search: 'always', '*': 'never' })
    expect(options.extra).toMatchObject({ providerRequestId: 'provider_req_1' })
  })

  for (const parityCase of CANONICAL_OPTIONS_PARITY_CASES) {
    it.todo(`Phase ${parityCase.phase}: ${parityCase.name}`)
  }
})

