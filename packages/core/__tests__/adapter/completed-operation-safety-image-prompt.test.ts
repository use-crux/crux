/** Typed image prompt Safety preparation before provider normalization. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { prompt, resetHooks, setHooks } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, constraint, guardrail } from '../../src/safety'
import { loweringImageOperation } from './completed-operation-safety-image-prompt.fixture'

afterEach(() => resetHooks())

describe('completed operation Safety — typed image prompts', () => {
  it('merges global, prompt, and call policies over exact user/system text once', async () => {
    const resolution = vi.fn()
    const calls: string[] = []
    const global = guardrail({
      id: 'global-image-user',
      on: boundary.input.text(),
      run: (text, context) => {
        calls.push(`global:${context.boundary.id}:${context.model.id}:${text}`)
        return { action: 'allow' }
      },
    })
    const promptUser = guardrail({
      id: 'prompt-image-user',
      on: boundary.input.text(),
      run: (text, context) => {
        calls.push(`prompt:${context.boundary.id}:${context.model.id}:${text}`)
        return {
          action: 'rewrite',
          value: 'guarded user',
          rewrite: { kind: 'normalize' },
        }
      },
    })
    const promptSystem = guardrail({
      id: 'prompt-image-system',
      on: boundary.input.instructions(),
      run: (text, context) => {
        calls.push(`prompt:${context.boundary.id}:${context.model.id}:${text}`)
        return {
          action: 'rewrite',
          value: 'guarded system',
          rewrite: { kind: 'normalize' },
        }
      },
    })
    const call = guardrail({
      id: 'call-image-user',
      on: boundary.input.text(),
      run: (text, context) => {
        calls.push(`call:${context.boundary.id}:${context.model.id}:${text}`)
        return { action: 'allow' }
      },
    })
    setHooks({ globalGuardrails: [global] })
    const typed = prompt({
      id: 'typed-image',
      system: 'original system',
      prompt: 'original user',
      guardrails: [promptUser, promptSystem],
      hooks: { onPrepare: resolution },
    })
    const events: string[] = []
    let normalizedPrompt: unknown
    let normalizedText: string | undefined
    const generateImage = bindCompletedOperation({
      definition: loweringImageOperation(events, (input, text) => {
        normalizedPrompt = input.prompt
        normalizedText = text
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: typed,
      guardrails: [call],
    })

    expect(resolution).toHaveBeenCalledOnce()
    expect(calls).toEqual([
      'global:model.input.text:image-model:original user',
      'prompt:model.input.text:image-model:original user',
      'call:model.input.text:image-model:guarded user',
      'prompt:model.instructions:image-model:original system',
    ])
    expect(normalizedPrompt).toBe('guarded system\nguarded user')
    expect(normalizedText).toBe('guarded system\nguarded user')
    expect(events).toEqual(['normalize:image-model', 'invoke:image-model'])
    expect(result.safety?.guardrails?.applied).toHaveLength(4)
  })

  it('retains the actionable constraint rejection before normalization or native I/O', async () => {
    const typed = prompt({
      prompt: 'Draw this.',
      constraints: [
        constraint({
          id: 'unsupported-image-constraint',
          on: boundary.output.text(),
          check: () => ({ pass: true }),
        }),
      ],
    })
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: loweringImageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: typed,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'unsupported_capability',
      issues: [expect.objectContaining({ capability: 'image.output.constraints' })],
    })
    expect(events).toEqual([])
  })

  it('rejects an inapplicable prompt-scoped policy before normalization or native I/O', async () => {
    const typed = prompt({
      prompt: 'Draw this.',
      guardrails: [
        guardrail({
          id: 'typed-image-output-text',
          on: boundary.output.text(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    })
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: loweringImageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: typed,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'SafetyConfigError',
      boundaries: ['model.output.text'],
      kinds: ['guardrail'],
      scopes: ['prompt'],
    })
    expect(events).toEqual([])
  })
})
