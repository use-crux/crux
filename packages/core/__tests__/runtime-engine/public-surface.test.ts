import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '@use-crux/core/runtime'
import { runStoreAdapterTests } from '@use-crux/core/runtime/testing'

describe('@use-crux/core runtime store public surface', () => {
  it('exports the in-memory store and conformance suite from package subpaths', () => {
    expect(typeof inMemoryRuntimeStore).toBe('function')
    expect(typeof inMemoryRuntimeStore().transact).toBe('function')
    expect(typeof runStoreAdapterTests).toBe('function')
  })
})
