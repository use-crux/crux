/**
 * Public adapter profile boundary tests for `@crux/ai`.
 */

import { describe, expect, it } from 'vitest'
import { prompt as makePrompt } from '@crux/core'
import { z } from 'zod'
import { aiSdkProfile } from '../src/profile'
import { emissionModel } from './mock-model'
import { scriptedGateway } from './scripted-gateway'

describe('aiSdkProfile', () => {
  it('creates an SDK-loop runtime through the public profile compiler', async () => {
    const scripted = scriptedGateway({ generateText: [{ text: 'profile text' }] })
    const runtime = aiSdkProfile.create(scripted.gateway)
    const model = emissionModel([{ text: 'unused by scripted gateway' }])
    const profilePrompt = makePrompt({
      id: 'ai-sdk-profile-text',
      input: z.object({ instruction: z.string() }),
      prompt: ({ input }) => input.instruction,
    })

    const result = await runtime.generate(profilePrompt, {
      model,
      input: { instruction: 'Write with the profile' },
    })

    expect(runtime.executorId).toBe('ai-sdk')
    expect(result.text).toBe('profile text')
    expect(scripted.calls.generateText).toHaveLength(1)
    expect(scripted.calls.generateText[0]?.model).toBe(model)
  })
})
