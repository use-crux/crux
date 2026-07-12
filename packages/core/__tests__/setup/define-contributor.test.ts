import { describe, expect, it } from 'vitest'

import { defineSetupContributor } from '../../src/setup/index.js'

describe('defineSetupContributor', () => {
  it('returns a frozen contributor and rejects an empty id', () => {
    const contributor = defineSetupContributor({
      id: 'runtime',
      inspect: async () => [],
      plan: async () => [],
    })

    expect(Object.isFrozen(contributor)).toBe(true)
    expect(() =>
      defineSetupContributor({
        id: '',
        inspect: async () => [],
        plan: async () => [],
      }),
    ).toThrow('Setup contributor id must not be empty')
  })
})
