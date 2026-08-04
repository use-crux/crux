/**
 * The AI SDK loop runtime must pass the core loop runtime conformance suite.
 * The harness scripts model behavior with `MockLanguageModelV3` through the
 * live gateway, so the suite exercises real `generateText` loop mechanics
 * (stopWhen, prepareStep buffering, native approval suspension).
 */

import { describe, it, expect } from 'vitest'
import type { LanguageModel } from 'ai'
import { loopRuntimePortConformance } from '@use-crux/core/adapter/testing'
import type { LoopRuntimeConformanceHarness } from '@use-crux/core/adapter/testing'
import { createAiSdkLoopRuntime } from '../src/executor'
import { liveSdkGateway } from '../src/gateway'
import { emissionModel, structuredModel } from './mock-model'

describe('AI SDK loop runtime conformance', () => {
  it('conforms to the LoopRuntimePort contract via real generateText', async () => {
    const harness: LoopRuntimeConformanceHarness<LanguageModel> = {
      prepare: (script) => ({
        runtime: createAiSdkLoopRuntime(liveSdkGateway()),
        model: script.structuredTexts ? structuredModel(script.structuredTexts) : emissionModel(script.emissions ?? []),
      }),
    }

    const violations = await loopRuntimePortConformance(harness)
    expect(violations).toEqual([])
  })
})
