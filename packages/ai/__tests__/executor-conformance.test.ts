/**
 * The internal SDK-loop executor must pass the core executor conformance
 * suite. The harness scripts model behavior with `MockLanguageModelV3`
 * through the live gateway, so the suite exercises real `generateText` loop
 * mechanics (stopWhen, prepareStep buffering, native approval suspension).
 */

import { describe, it, expect } from 'vitest'
import type { LanguageModel } from 'ai'
import { executorSpecConformance } from '@crux/core/adapter'
import type { ExecutorConformanceHarness } from '@crux/core/adapter'
import { aiSdkExecutor } from '../src/executor'
import { liveSdkGateway } from '../src/gateway'
import type { SdkGateway } from '../src/gateway'
import { emissionModel, structuredModel } from './mock-model'

describe('internal SDK-loop executor conformance', () => {
  it('conforms to the compiled executor contract via real generateText', async () => {
    const gateway = liveSdkGateway()
    const harness: ExecutorConformanceHarness<SdkGateway, LanguageModel> = {
      prepare: (script) => ({
        client: gateway,
        model: script.structuredTexts ? structuredModel(script.structuredTexts) : emissionModel(script.emissions ?? []),
      }),
    }

    const violations = await executorSpecConformance(aiSdkExecutor, harness)
    expect(violations).toEqual([])
  })
})
