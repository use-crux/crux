import { describe, expect, it } from 'vitest'
import { withCrux } from '../../src/runtime/next'

describe('withCrux', () => {
  it('runs runtime artifact generation before delegating to the user webpack hook', () => {
    const calls: string[] = []
    const config = withCrux(
      {
        webpack(input) {
          calls.push('user-webpack')
          return { ...input, user: true }
        },
      },
      { command: ['node', '-e', 'process.exit(0)'] },
    )

    const output = config.webpack?.({ base: true }, {})

    expect(output).toEqual({ base: true, user: true })
    expect(calls).toEqual(['user-webpack'])
  })

  it('throws ARTIFACTS_STALE when generation fails', () => {
    expect(() => withCrux({}, { command: ['node', '-e', 'process.exit(7)'] })).toThrow(/Code: ARTIFACTS_STALE/)
  })
})
