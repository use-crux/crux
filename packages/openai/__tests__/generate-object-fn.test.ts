import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import { z } from 'zod'
import { createGenerateObjectFn } from '../src'

interface OpenAIParseRequest {
  readonly model: string
  readonly messages: readonly { readonly role: string; readonly content: string }[]
  readonly response_format: unknown
}

interface OpenAIParseResponse {
  readonly choices: readonly [
    {
      readonly message: {
        readonly parsed?: unknown
      }
    },
  ]
}

function createOpenAIHelperFake(respond: (request: OpenAIParseRequest) => Promise<OpenAIParseResponse>) {
  const calls: OpenAIParseRequest[] = []
  const fake = {
    chat: {
      completions: {
        parse: async (request: OpenAIParseRequest) => {
          calls.push(request)
          return respond(request)
        },
      },
    },
  }

  return { calls, client: fake as unknown as OpenAI }
}

function openAIRequestShape(request: OpenAIParseRequest | undefined) {
  const responseFormat = asRecord(request?.response_format)
  const jsonSchema = asRecord(responseFormat.json_schema)

  return {
    model: request?.model,
    messages: request?.messages,
    response_format: {
      type: responseFormat.type,
      json_schema: {
        name: jsonSchema.name,
        strict: jsonSchema.strict,
        schema: jsonSchema.schema,
      },
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

describe('createGenerateObjectFn', () => {
  it('sends the schema to OpenAI parse and returns the parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createOpenAIHelperFake(async () => ({
      choices: [{ message: { parsed: { ok: true } } }],
    }))
    const generateObject = createGenerateObjectFn(client, 'gpt-4o')

    const result = await generateObject({
      model: 'ignored-per-call-model',
      system: 'Return JSON.',
      prompt: 'Check this.',
      schema,
    })

    expect(result).toEqual({ object: { ok: true } })
    expect(calls[0]).toMatchObject({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Check this.' },
      ],
      response_format: expect.objectContaining({ type: 'json_schema' }),
    })
    expect(openAIRequestShape(calls[0])).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "Return JSON.",
            "role": "system",
          },
          {
            "content": "Check this.",
            "role": "user",
          },
        ],
        "model": "gpt-4o",
        "response_format": {
          "json_schema": {
            "name": "output",
            "schema": {
              "$schema": "https://json-schema.org/draft/2020-12/schema",
              "additionalProperties": false,
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
            "strict": true,
          },
          "type": "json_schema",
        },
      }
    `)
  })

  it('throws when OpenAI returns no parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { client } = createOpenAIHelperFake(async () => ({
      choices: [{ message: {} }],
    }))
    const generateObject = createGenerateObjectFn(client, 'gpt-4o-mini')

    await expect(generateObject({ model: 'ignored', prompt: 'Check this.', schema })).rejects.toThrow(
      'OpenAI returned no parsed output',
    )
  })

  it('preserves provider errors', async () => {
    const providerError = new Error('openai parse failed')
    const schema = z.object({ ok: z.boolean() })
    const { client } = createOpenAIHelperFake(async () => {
      throw providerError
    })
    const generateObject = createGenerateObjectFn(client, 'gpt-4o-mini')

    await expect(generateObject({ model: 'ignored', prompt: 'Check this.', schema })).rejects.toBe(providerError)
  })
})
