/** Winning authored/discovered provenance for provider-visible tools. */

import { mcp, stdio } from '@use-crux/mcp'
import { describe, expect, it, vi } from 'vitest'
import { adapter } from '../../src/adapter/define-adapter'
import type { CallArgs } from '../../src/adapter/types'
import { prompt } from '../../src/prompt/prompt'
import { boundary, guardrail } from '../../src/safety'

const source = mcp({
  id: 'exposure-source',
  transport: stdio({ command: 'fixture-server' }),
})

function exposurePrompt() {
  return prompt({
    id: 'tool-exposure-provenance',
    use: [source],
    prompt: 'Use the available tool.',
  })
}

function fixture() {
  const requests: CallArgs[] = []
  const runtime = adapter({
    providerId: 'tool-exposure-provenance',
    materializeToolSource: async () => ({
      tools: {
        lookup: {
          description: 'discovered lookup',
          execute: async () => 'discovered',
        },
      },
      close: vi.fn(),
    }),
    async call(_client, args) {
      requests.push(args)
      return {
        raw: {},
        extracted: {
          text: 'done',
          usage: undefined,
          finishReason: 'stop' as const,
        },
      }
    },
    async stream() {
      throw new Error('stream is not used')
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  })({})
  return { runtime, requests }
}

describe('tool exposure provenance', () => {
  it('carries stable discovery source identity to filtered policies', async () => {
    const seen: unknown[] = []
    const authored = vi.fn(() => ({ action: 'allow' as const }))
    const harness = fixture()

    await harness.runtime.generate(exposurePrompt(), {
      model: 'test-model',
      guardrails: [
        guardrail({
          id: 'discovered-tool-policy',
          on: boundary.input.tools({ from: 'discovered' }),
          run: (_subject, context) => {
            seen.push(context.origin)
            return { action: 'allow' }
          },
        }),
        guardrail({
          id: 'authored-tool-policy',
          on: boundary.input.tools({ from: 'authored' }),
          run: authored,
        }),
      ],
    })

    expect(seen).toEqual([
      {
        source: 'tool-definition',
        kind: 'discovered',
        toolName: 'lookup',
        sourceId: 'exposure-source',
        sourceKind: 'mcp',
      },
    ])
    expect(authored).not.toHaveBeenCalled()
  })

  it('classifies a call-site definition as authored when it wins the merge', async () => {
    const seen: unknown[] = []
    const discovered = vi.fn(() => ({ action: 'allow' as const }))
    const harness = fixture()

    await harness.runtime.generate(exposurePrompt(), {
      model: 'test-model',
      tools: {
        lookup: {
          description: 'call-site lookup',
          execute: async () => 'authored',
        },
      },
      guardrails: [
        guardrail({
          id: 'winning-authored-tool',
          on: boundary.input.tools({ from: 'authored' }),
          run: (_subject, context) => {
            seen.push(context.origin)
            return { action: 'allow' }
          },
        }),
        guardrail({
          id: 'losing-discovered-tool',
          on: boundary.input.tools({ from: 'discovered' }),
          run: discovered,
        }),
      ],
    })

    expect(seen).toEqual([
      {
        source: 'tool-definition',
        kind: 'authored',
        toolName: 'lookup',
      },
    ])
    expect(discovered).not.toHaveBeenCalled()
    expect(harness.requests[0]?.tools?.[0]?.description).toBe(
      'call-site lookup',
    )
  })
})
