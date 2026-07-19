/** Candidate-stable typed image prompt Safety across completed routing. */

import { describe, expect, it } from 'vitest'
import { fallback } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { router } from '../../src/routing'
import { boundary, guardrail, GuardrailBlockedError, SafetyConfigError } from '../../src/safety'
import { candidateImagePrompt, loweringImageOperation } from './completed-operation-safety-image-prompt.fixture'

describe('completed operation Safety — routed typed image prompts', () => {
  it('resolves all policy projections but guards and normalizes only the selected route', async () => {
    const resolutions: string[] = []
    const guards: string[] = []
    const policy = guardrail({
      id: 'stable-candidate-policy',
      on: [boundary.input.user(), boundary.input.model()] as const,
      run: (text, context) => {
        guards.push(`${context.model.id}:${context.boundary.id}:${text}`)
        return { action: 'allow' }
      },
    })
    const typed = candidateImagePrompt((modelId) => {
      resolutions.push(modelId)
      return {
        system: `system for ${modelId}`,
        prompt: `user for ${modelId}`,
        settings: {},
        guardrails: [policy],
      }
    })
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: loweringImageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    await generateImage({
      model: router({
        classify: () => 'selected' as const,
        routes: { selected: 'selected/model', default: 'unused/model' },
      }),
      prompt: typed,
    })

    expect(resolutions).toEqual(['selected/model', 'unused/model'])
    expect(guards).toEqual([
      'selected/model:user.input:user for selected/model',
      'selected/model:model.input:system for selected/model',
    ])
    expect(events).toEqual(['normalize:selected/model', 'invoke:selected/model'])
  })

  it('rejects conflicting candidate policy definitions before normalization or native I/O', async () => {
    const first = guardrail({
      id: 'candidate-policy',
      on: boundary.input.user(),
      run: () => ({ action: 'allow' }),
    })
    const second = guardrail({
      id: 'candidate-policy',
      on: boundary.input.user(),
      run: () => ({ action: 'allow' }),
    })
    const resolutions: string[] = []
    const typed = candidateImagePrompt((modelId) => {
      resolutions.push(modelId)
      return {
        prompt: `user for ${modelId}`,
        settings: {},
        guardrails: [modelId === 'first/model' ? first : second],
      }
    })
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: loweringImageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: fallback(['first/model', 'second/model']),
      prompt: typed,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SafetyConfigError)
    expect(error).toMatchObject({ kinds: ['guardrail'], scopes: ['prompt'] })
    expect(resolutions).toEqual(['first/model', 'second/model'])
    expect(events).toEqual([])
  })

  it('treats candidate input Safety errors as terminal even with forced fallback', async () => {
    const guardedModels: string[] = []
    const transitions: string[] = []
    const policy = guardrail({
      id: 'terminal-candidate-policy',
      on: boundary.input.user(),
      run: (_text, context) => {
        guardedModels.push(context.model.id ?? 'unknown')
        return context.model.id === 'first/model'
          ? { action: 'block', reason: 'Candidate input is unsafe.' }
          : { action: 'allow' }
      },
    })
    const typed = candidateImagePrompt((modelId) => ({
      prompt: `user for ${modelId}`,
      settings: {},
      guardrails: [policy],
    }))
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: loweringImageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: fallback(['first/model', 'second/model'], {
        shouldFallback: () => true,
        onFallback: ({ from, to }) => transitions.push(`${from}->${to}`),
      }),
      prompt: typed,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(guardedModels).toEqual(['first/model'])
    expect(transitions).toEqual([])
    expect(events).toEqual([])
  })
})
