/**
 * `fakeExecutor()` must pass the executor conformance suite — it is the
 * reference implementation of the `ExecutorSpec` contract. Real executors
 * (e.g. `@crux/ai`'s AiSdkExecutor) run this same suite with their own
 * harness, which is what makes fake-backed policy tests transferable.
 */

import { describe, it, expect } from 'vitest'
import { fakeExecutor, executorSpecConformance } from '../../adapter/testing'
import type { ExecutorConformanceHarness, FakeExecutor, FakeExecutorClient } from '../../adapter/testing'

describe('executorSpecConformance', () => {
  it('fakeExecutor conforms to the ExecutorSpec contract', async () => {
    // Each prepare() call scripts a fresh fake; a delegating spec routes the
    // suite's calls to the most recently prepared instance.
    let current: FakeExecutor = fakeExecutor()
    const delegating: FakeExecutor['spec'] = {
      executorId: 'fake',
      describeModel: (model) => current.spec.describeModel(model),
      mapSettings: (settings, model) => current.spec.mapSettings(settings, model),
      runLoop: (client, request) => current.spec.runLoop(client, request),
      attemptStructured: (client, request) => current.spec.attemptStructured(client, request),
      runStream: (client, request) => current.spec.runStream(client, request),
    }
    const harness: ExecutorConformanceHarness<FakeExecutorClient, string> = {
      prepare: (script) => {
        current = fakeExecutor({
          ...(script.emissions ? { loops: [script.emissions] } : {}),
          ...(script.structuredTexts ? { structured: script.structuredTexts } : {}),
        })
        return { client: current.client, model: 'fake:conformance' }
      },
    }

    const violations = await executorSpecConformance(delegating, harness)
    expect(violations).toEqual([])
  })
})
