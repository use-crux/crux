import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../src/observability'
import { prompt } from '../src/prompt/prompt'
import { toolPolicy } from '../src/safety/toolPolicy'
import { createMcpPolicyFixture } from './adapter/mcp-policy-fixture'

describe('toolPolicy observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records authored tools through the shared policy decision recorder', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const execute = vi.fn(async () => ({ status: 'found' }))
    const assistant = prompt({
      id: 'authored-tool-policy-report',
      prompt: 'Use the tool.',
      tools: {
        lookup: {
          description: 'Look up a record.',
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
      toolMiddleware: toolPolicy({
        id: 'report-authored-lookup',
        match: 'lookup',
        action: 'report',
        reason: 'Lookup observed.',
      }),
    })
    const fixture = createMcpPolicyFixture({
      tools: {},
      toolName: 'lookup',
      input: { id: 'record-1' },
    })

    await fixture.adapter.generate(assistant, { model: 'fixture-model' })
    await observe.flush()

    expect(execute).toHaveBeenCalledOnce()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'security.report',
        preview: expect.objectContaining({
          policyId: 'report-authored-lookup',
          mode: 'report',
          action: 'warn',
          severity: 'warn',
        }),
      }),
    )
  })
})
