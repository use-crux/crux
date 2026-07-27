/** Provider-visible tool definition exposure gates. */

import { describe, expect, it, vi } from 'vitest'
import type { ResolvedPrompt } from '../../src/resolver/types'
import type {
  ToolDefinitionOrigin,
  ToolDefinitionSubject,
  ToolDescriptionOrigin,
} from '../../src/safety'
import {
  boundary,
  guardrail,
  SafetyResultError,
} from '../../src/safety'
import { adapter } from '../../src/adapter/define-adapter'
import { createToolLifecycle } from '../../src/adapter/tool/session'
import {
  toolIngressPrompt,
  toolIngressScript,
} from './tool-ingress.fixture'

function resolvedWith(partial: Partial<ResolvedPrompt>): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt
}

describe('tool exposure transaction', () => {
  it('freezes root subjects, rewrites annotations, and strips execution atomically', async () => {
    const executeKept = vi.fn(async () => 'kept')
    const executeStripped = vi.fn(async () => 'stripped')
    const roots: Array<{
      readonly subject: ToolDefinitionSubject
      readonly origin: ToolDefinitionOrigin
    }> = []
    const descriptions: Array<{
      readonly text: string
      readonly origin: ToolDescriptionOrigin
    }> = []
    const lifecycle = createToolLifecycle({
      regime: 'core',
      resolved: resolvedWith({
        tools: {
          kept: {
            description: 'internal lookup',
            parameters: {
              type: 'object',
              title: 'Internal request',
              properties: {
                query: {
                  type: 'string',
                  description: 'internal query',
                },
              },
            },
            execute: executeKept,
          },
          stripped: {
            description: 'remove me',
            parameters: { type: 'object' },
            execute: executeStripped,
          },
        },
      }),
      promptId: 'tool-exposure',
    })

    await lifecycle.guardExposure({
      root: async (subject, origin) => {
        roots.push({ subject, origin })
        expect(Object.isFrozen(subject)).toBe(true)
        expect(Object.isFrozen(subject.parameters)).toBe(true)
        if (subject.name === 'kept') {
          expect(
            Object.isFrozen(
              (subject.parameters.properties as Record<string, unknown>).query,
            ),
          ).toBe(true)
        }
        expect(subject).not.toHaveProperty('execute')
        return subject.name === 'stripped'
          ? { action: 'strip', reason: 'not exposed' }
          : { action: 'allow' }
      },
      descriptions: async (text, origin) => {
        descriptions.push({ text, origin })
        const value = text.replace(/internal/gi, 'public')
        return value !== text
          ? {
              action: 'rewrite',
              value,
              rewrite: { kind: 'normalize' },
            }
          : { action: 'allow' }
      },
    })

    expect(roots.map(({ subject }) => subject.name)).toEqual([
      'kept',
      'stripped',
    ])
    expect(roots.map(({ origin }) => origin)).toEqual([
      {
        source: 'tool-definition',
        kind: 'authored',
        toolName: 'kept',
      },
      {
        source: 'tool-definition',
        kind: 'authored',
        toolName: 'stripped',
      },
    ])
    expect(descriptions.map(({ text }) => text)).toEqual([
      'internal lookup',
      'Internal request',
      'internal query',
    ])
    expect(descriptions.map(({ origin }) => origin)).toEqual([
      expect.objectContaining({
        descriptionKind: 'tool',
        toolName: 'kept',
      }),
      expect.objectContaining({
        descriptionKind: 'schema',
        schemaDepth: 0,
        toolName: 'kept',
      }),
      expect.objectContaining({
        descriptionKind: 'schema',
        schemaDepth: 2,
        toolName: 'kept',
      }),
    ])
    expect(lifecycle.descriptors).toEqual([
      expect.objectContaining({
        name: 'kept',
        description: 'public lookup',
        parameters: expect.objectContaining({
          title: 'public request',
          properties: {
            query: {
              type: 'string',
              description: 'public query',
            },
          },
        }),
      }),
    ])

    const round = await lifecycle.executeRound(
      {
        text: '',
        toolCalls: [
          { id: 'stripped-call', name: 'stripped', args: {} },
          { id: 'kept-call', name: 'kept', args: {} },
        ],
        usage: undefined,
        finishReason: 'tool_calls',
        responseId: undefined,
        actualModelId: undefined,
      },
      [],
    )
    expect(round.kind).toBe('completed')
    expect(executeStripped).not.toHaveBeenCalled()
    expect(executeKept).toHaveBeenCalledOnce()
  })

  it('rewrites exact provider annotations without exposing schema paths in audit', async () => {
    const origins: ToolDescriptionOrigin[] = []
    const scripted = toolIngressScript([{ text: 'done' }])
    const result = await adapter(scripted.spec)(scripted.client).generate(
      toolIngressPrompt(),
      {
        model: 'test-model',
        input: { message: 'go' },
        tools: {
          lookup: {
            description: 'internal lookup',
            parameters: {
              type: 'object',
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
            id: 'rewrite-tool-descriptions',
            on: boundary.input.tools().descriptions(),
            run: (text, context) => {
              origins.push(context.origin)
              return {
                action: 'rewrite',
                value: text.replaceAll('internal', 'public'),
                rewrite: { kind: 'normalize' },
              }
            },
          }),
        ],
      },
    )

    expect(scripted.providerTools[0]).toEqual([
      expect.objectContaining({
        name: 'lookup',
        description: 'public lookup',
        parameters: expect.objectContaining({
          properties: {
            query: {
              type: 'string',
              description: 'public query',
            },
          },
        }),
      }),
    ])
    expect(origins).toEqual([
      expect.objectContaining({
        descriptionKind: 'tool',
        toolName: 'lookup',
      }),
      expect.objectContaining({
        descriptionKind: 'schema',
        schemaDepth: 2,
        toolName: 'lookup',
      }),
    ])
    for (const entry of result._meta.guardrails?.applied ?? []) {
      expect(entry).not.toHaveProperty('path')
      expect(entry.origin).not.toHaveProperty('path')
    }
  })

  it('retains report-mode strips in provider exposure and execution', async () => {
    const execute = vi.fn(async () => 'result')
    const scripted = toolIngressScript([
      {
        text: '',
        toolCalls: [{ id: 'lookup-call', name: 'lookup', args: {} }],
      },
      { text: 'done' },
    ])
    const result = await adapter(scripted.spec)(scripted.client).generate(
      toolIngressPrompt(),
      {
        model: 'test-model',
        input: { message: 'go' },
        tools: { lookup: { description: 'lookup', execute } },
        guardrails: [
          guardrail({
            id: 'report-tool-strip',
            mode: 'report',
            on: boundary.input.tools(),
            run: () => ({ action: 'strip', reason: 'observe only' }),
          }),
        ],
      },
    )

    expect(scripted.providerTools[0]?.map((tool) => tool.name)).toEqual([
      'lookup',
    ])
    expect(execute).toHaveBeenCalledOnce()
    expect(result._meta.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'report-tool-strip',
        action: 'strip',
        mode: 'report',
      }),
    ])
  })

  it('fails closed on malformed root actions before provider transport', async () => {
    const scripted = toolIngressScript([{ text: 'unreachable' }])
    const malformed = guardrail({
      id: 'malformed-tool-action',
      on: boundary.input.tools(),
      run: (() => ({ action: 'rewrite' })) as never,
    })

    await expect(
      adapter(scripted.spec)(scripted.client).generate(toolIngressPrompt(), {
        model: 'test-model',
        input: { message: 'go' },
        tools: { lookup: { description: 'lookup' } },
        guardrails: [malformed],
      }),
    ).rejects.toBeInstanceOf(SafetyResultError)
    expect(scripted.calls).toBe(0)
  })
})
