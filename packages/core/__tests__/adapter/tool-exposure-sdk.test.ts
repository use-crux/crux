/** SDK-loop provider descriptors and executable registry after exposure. */

import { describe, expect, it, vi } from 'vitest'
import { loopRuntimeAdapter } from '../../src/adapter/define-executor'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import { boundary, guardrail } from '../../src/safety'
import { toolIngressPrompt } from './tool-ingress.fixture'

describe('SDK tool exposure', () => {
  it('uses rewritten tool and wire-schema annotations', async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: 'done' }]] })

    await loopRuntimeAdapter(fake.runtime).generate(toolIngressPrompt(), {
      model: 'fake:test-model',
      input: { message: 'go' },
      tools: {
        lookup: {
          description: 'internal lookup',
          parameters: {
            type: 'object',
            title: 'internal request',
            properties: {
              query: {
                type: 'string',
                description: 'internal query',
              },
            },
          },
          execute: async () => 'result',
        },
      },
      guardrails: [
        guardrail({
          id: 'rewrite-sdk-tool-descriptions',
          on: boundary.input.tools().descriptions(),
          run: (text) => ({
            action: 'rewrite',
            value: text.replaceAll('internal', 'public'),
            rewrite: { kind: 'normalize' },
          }),
        }),
      ],
    })

    const request = fake.calls.runTextLoop[0]
    expect(request?.tools?.lookup).toEqual(
      expect.objectContaining({ description: 'public lookup' }),
    )
    expect(request?.toolWireSchemas?.lookup).toEqual(
      expect.objectContaining({
        title: 'public request',
        properties: {
          query: {
            type: 'string',
            description: 'public query',
          },
        },
      }),
    )
  })

  it('does not register an enforced stripped tool for SDK execution', async () => {
    const execute = vi.fn(async () => 'must not run')
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            toolCalls: [{ id: 'hidden-call', name: 'hidden', args: {} }],
          },
          { text: 'done' },
        ],
      ],
    })

    await loopRuntimeAdapter(fake.runtime).generate(toolIngressPrompt(), {
      model: 'fake:test-model',
      input: { message: 'go' },
      tools: {
        hidden: { description: 'hidden', execute },
      },
      guardrails: [
        guardrail({
          id: 'strip-sdk-tool',
          on: boundary.input.tools(),
          run: () => ({ action: 'strip', reason: 'not exposed' }),
        }),
      ],
    })

    expect(fake.calls.runTextLoop[0]?.tools).toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
  })

  it('retains a report-mode blocked tool for exposure and execution', async () => {
    const execute = vi.fn(async () => 'visible')
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            toolCalls: [{ id: 'visible-call', name: 'visible', args: {} }],
          },
          { text: 'done' },
        ],
      ],
    })

    const result = await loopRuntimeAdapter(fake.runtime).generate(
      toolIngressPrompt(),
      {
        model: 'fake:test-model',
        input: { message: 'go' },
        tools: { visible: { description: 'visible', execute } },
        guardrails: [
          guardrail({
            id: 'report-sdk-tool-block',
            mode: 'report',
            on: boundary.input.tools(),
            run: () => ({ action: 'block', reason: 'observe only' }),
          }),
        ],
      },
    )

    expect(fake.calls.runTextLoop[0]?.tools).toHaveProperty('visible')
    expect(execute).toHaveBeenCalledOnce()
    expect(result._meta.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'report-sdk-tool-block',
        action: 'block',
        mode: 'report',
      }),
    ])
  })

  it('audits a report-mode rewrite without changing the exposed description', async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: 'done' }]] })

    const result = await loopRuntimeAdapter(fake.runtime).generate(
      toolIngressPrompt(),
      {
        model: 'fake:test-model',
        input: { message: 'go' },
        tools: { lookup: { description: 'internal lookup' } },
        guardrails: [
          guardrail({
            id: 'report-sdk-description-rewrite',
            mode: 'report',
            on: boundary.input.tools().descriptions(),
            run: () => ({
              action: 'rewrite',
              value: 'public lookup',
              rewrite: { kind: 'normalize' },
            }),
          }),
        ],
      },
    )

    expect(fake.calls.runTextLoop[0]?.tools?.lookup).toEqual(
      expect.objectContaining({ description: 'internal lookup' }),
    )
    expect(result._meta.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'report-sdk-description-rewrite',
        action: 'transform',
        mode: 'report',
      }),
    ])
  })
})
