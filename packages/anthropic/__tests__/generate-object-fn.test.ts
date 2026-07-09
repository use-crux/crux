import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createGenerateObjectFn } from '../src'

interface AnthropicParseRequest {
  readonly model: string
  readonly system?: string
  readonly messages: readonly { readonly role: string; readonly content: string }[]
  readonly max_tokens: number
  readonly output_config: {
    readonly format: unknown
  }
}

interface AnthropicParseResponse {
  readonly parsed_output?: unknown
}

function createAnthropicHelperFake(respond: (request: AnthropicParseRequest) => Promise<AnthropicParseResponse>) {
  const calls: AnthropicParseRequest[] = []
  const fake = {
    messages: {
      parse: async (request: AnthropicParseRequest) => {
        calls.push(request)
        return respond(request)
      },
    },
  }

  return { calls, client: fake as unknown as Anthropic }
}

function anthropicRequestShape(request: AnthropicParseRequest | undefined) {
  const outputFormat = asRecord(request?.output_config.format)

  return {
    model: request?.model,
    system: request?.system,
    messages: request?.messages,
    max_tokens: request?.max_tokens,
    output_config: {
      format: {
        type: outputFormat.type,
        name: outputFormat.name,
        schema: outputFormat.schema,
      },
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

describe('createGenerateObjectFn', () => {
  it('sends the schema to Anthropic parse and returns the parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createAnthropicHelperFake(async () => ({
      parsed_output: { ok: true },
    }))
    const generateObject = createGenerateObjectFn(client, 'claude-sonnet-4-5-20250929')

    const result = await generateObject({
      model: 'ignored-per-call-model',
      system: 'Return JSON.',
      prompt: 'Check this.',
      schema,
    })

    expect(result).toEqual({ object: { ok: true } })
    expect(calls[0]).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'Check this.' }],
      output_config: { format: expect.anything() },
    })
    expect(anthropicRequestShape(calls[0])).toMatchInlineSnapshot(`
      {
        "max_tokens": 4096,
        "messages": [
          {
            "content": "Check this.",
            "role": "user",
          },
        ],
        "model": "claude-sonnet-4-5-20250929",
        "output_config": {
          "format": {
            "name": undefined,
            "schema": {
              "additionalProperties": false,
              "description": "{$schema: "https://json-schema.org/draft/2020-12/schema"}",
              "properties": {
                "ok": {
                  "type": "boolean",
                },
              },
              "required": [
                "ok",
              ],
              "type": "object",
            },
            "type": "json_schema",
          },
        },
        "system": "Return JSON.",
      }
    `)
  })

  it('throws when Anthropic returns no parsed output', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { client } = createAnthropicHelperFake(async () => ({}))
    const generateObject = createGenerateObjectFn(client, 'claude-sonnet-4-5-20250929')

    await expect(generateObject({ model: 'ignored', prompt: 'Check this.', schema })).rejects.toThrow(
      'Anthropic returned no parsed output',
    )
  })

  it('preserves provider errors', async () => {
    const providerError = new Error('anthropic parse failed')
    const schema = z.object({ ok: z.boolean() })
    const { client } = createAnthropicHelperFake(async () => {
      throw providerError
    })
    const generateObject = createGenerateObjectFn(client, 'claude-sonnet-4-5-20250929')

    await expect(generateObject({ model: 'ignored', prompt: 'Check this.', schema })).rejects.toBe(providerError)
  })
})
