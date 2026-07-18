import { episodes, inMemoryRecordStore, memory } from '@use-crux/core/memory'
import { describe, expect, it } from 'vitest'
import { afterPreparedAgentCall } from '../src/agent/lifecycle-persistence'
import { collectResultToolCalls } from '../src/agent/lifecycle-result-tools'

describe('Convex Agent memory tool capture', () => {
  it('collects results and errors from AI SDK result, step, and content shapes', () => {
    const calls = collectResultToolCalls({
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'topLevel', input: { query: 'one' } },
        { toolCallId: 'call-2', toolName: 'stepResult', input: { query: 'two' } },
        { toolCallId: 'call-3', toolName: 'stepError', input: { query: 'three' } },
        { toolCallId: 'call-4', toolName: 'structuredError', input: {} },
        { toolCallId: 'call-5', toolName: 'primitiveError', input: {} },
      ],
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'topLevel',
          input: { query: 'one' },
          output: { answer: 1 },
        },
      ],
      steps: [
        {
          toolResults: [
            {
              type: 'tool-result',
              toolCallId: 'call-2',
              toolName: 'stepResult',
              input: { query: 'two' },
              output: { answer: 2 },
            },
          ],
          content: [
            {
              type: 'tool-error',
              toolCallId: 'call-3',
              toolName: 'stepError',
              input: { query: 'three' },
              error: new Error('boom'),
            },
            {
              type: 'tool-error',
              toolCallId: 'call-4',
              toolName: 'structuredError',
              input: {},
              error: { code: 'E_TIMEOUT' },
            },
            {
              type: 'tool-error',
              toolCallId: 'call-5',
              toolName: 'primitiveError',
              input: {},
              error: 503,
            },
          ],
        },
      ],
    })

    expect(calls).toEqual([
      {
        id: 'call-1',
        name: 'topLevel',
        args: { query: 'one' },
        result: { answer: 1 },
      },
      {
        id: 'call-2',
        name: 'stepResult',
        args: { query: 'two' },
        result: { answer: 2 },
      },
      {
        id: 'call-3',
        name: 'stepError',
        args: { query: 'three' },
        error: 'boom',
      },
      {
        id: 'call-4',
        name: 'structuredError',
        args: {},
        error: '{"code":"E_TIMEOUT"}',
      },
      {
        id: 'call-5',
        name: 'primitiveError',
        args: {},
        error: '503',
      },
    ])
  })

  it('forwards enriched tool events through lifecycle persistence before flushing', async () => {
    const records = inMemoryRecordStore()
    const episodeBlock = episodes({ id: 'episodes' })
    const agentMemory = memory({
      id: 'convex-agent-memory',
      records,
      namespace: 'thread:1',
      blocks: [episodeBlock],
    })

    await afterPreparedAgentCall({
      resolved: {
        settings: {},
        memoryBindings: [{ memory: agentMemory, promptId: 'agent-prompt' }],
      } as never,
      input: {},
      result: {
        text: 'done',
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'lookup', input: { query: 'memory' } },
          { toolCallId: 'call-2', toolName: 'fail', input: {} },
        ],
        toolResults: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'lookup',
            input: { query: 'memory' },
            output: { answer: 'found' },
          },
        ],
        steps: [
          {
            content: [
              {
                type: 'tool-error',
                toolCallId: 'call-2',
                toolName: 'fail',
                input: {},
                error: 'boom',
              },
            ],
          },
        ],
      },
    })

    const entries = await episodeBlock.list({
      records,
      namespace: 'thread:1',
      memoryId: 'convex-agent-memory',
    })
    expect(entries.map((entry) => entry.content)).toEqual(
      expect.arrayContaining([
        'assistant: done',
        'tool:lookup: {"answer":"found"}',
        'tool:fail: "boom"',
      ]),
    )
    expect(entries).toHaveLength(3)
  })
})
