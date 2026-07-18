import { describe, expect, it } from 'vitest'
import { withCruxBuild } from '../../src/runtime/next'

describe('withCruxBuild', () => {
  it('runs runtime artifact generation before delegating to the user webpack hook', () => {
    const calls: string[] = []
    const config = withCruxBuild(
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
    expect(() =>
      withCruxBuild({}, { command: ['node', '-e', 'process.exit(7)'] }),
    ).toThrow(/Code: ARTIFACTS_STALE/)
  })
})
