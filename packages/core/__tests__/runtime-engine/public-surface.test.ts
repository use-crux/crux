import { describe, expect, it } from 'vitest'
import {
  createOutboxDispatcher,
  createRuntime,
  createRuntimeKernel,
  inMemoryRuntimeStore,
  node,
  runtimeRequiredError,
} from '@use-crux/core/runtime'
import {
  runRuntimeEngineAdapterTests,
  runStoreAdapterTests,
} from '@use-crux/core/runtime/testing'

describe('@use-crux/core runtime store public surface', () => {
  it('exports the in-memory store and conformance suite from package subpaths', () => {
    expect(typeof inMemoryRuntimeStore).toBe('function')
    expect(typeof inMemoryRuntimeStore().transact).toBe('function')
    expect(typeof createRuntimeKernel).toBe('function')
    expect(typeof createOutboxDispatcher).toBe('function')
    expect(typeof createRuntime).toBe('function')
    expect(typeof node).toBe('function')
    expect(typeof runtimeRequiredError).toBe('function')
    expect(typeof runStoreAdapterTests).toBe('function')
    expect(typeof runRuntimeEngineAdapterTests).toBe('function')
  })
})
