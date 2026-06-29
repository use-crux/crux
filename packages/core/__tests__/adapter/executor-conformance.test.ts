/**
 * `fakeLoopRuntime()` must pass the loop runtime conformance suite — it is the
 * reference implementation of the `LoopRuntimePort` contract. Real runtimes
 * (e.g. `@use-crux/ai`'s `createAiSdkLoopRuntime`) run this same suite with
 * their own harness, which is what makes fake-backed policy tests transferable.
 */

import { describe, it, expect } from 'vitest'
import { fakeLoopRuntime, loopRuntimePortConformance } from '../../adapter/testing'
import type { LoopRuntimeConformanceHarness } from '../../adapter/testing'

describe('loopRuntimePortConformance', () => {
  it('fakeLoopRuntime conforms to the LoopRuntimePort contract', async () => {
    // Each prepare() scripts a fresh fake runtime, already bound to its own
    // scripted state — the suite drives it directly.
    const harness: LoopRuntimeConformanceHarness<string> = {
      prepare: (script) => {
        const fake = fakeLoopRuntime({
          ...(script.emissions ? { loops: [script.emissions] } : {}),
          ...(script.structuredTexts ? { structured: script.structuredTexts } : {}),
        })
        return { runtime: fake.runtime, model: 'fake:conformance' }
      },
    }

    const violations = await loopRuntimePortConformance(harness)
    expect(violations).toEqual([])
  })
})
