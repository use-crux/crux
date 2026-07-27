import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import { z } from 'zod'
import { isUnsupportedCapabilityError, type ContentPart } from '@use-crux/core'
import { createGenerateObjectFn } from '../src'

interface OpenAIParseRequest {
  readonly model: string
  readonly messages: readonly { readonly role: string; readonly content: unknown }[]
  readonly response_format: unknown
  readonly temperature?: number
  readonly top_p?: number
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
  it('uses each call model, sends the schema, and returns the parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createOpenAIHelperFake(async () => ({
      choices: [{ message: { parsed: { ok: true } } }],
    }))
    const generateObject = createGenerateObjectFn(client)

    const result = await generateObject({
      model: 'gpt-4o',
      system: 'Return JSON.',
      prompt: 'Check this.',
      schema,
      temperature: 0,
      topP: 0.8,
    })
    await generateObject({
      model: 'gpt-4o-mini',
      prompt: 'Check this again.',
      schema,
    })

    expect(result).toEqual({ object: { ok: true } })
    expect(calls.map((call) => call.model)).toEqual(['gpt-4o', 'gpt-4o-mini'])
    expect(calls[0]).toMatchObject({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Check this.' },
      ],
      response_format: expect.objectContaining({ type: 'json_schema' }),
      temperature: 0,
      top_p: 0.8,
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
    const generateObject = createGenerateObjectFn(client)

    await expect(generateObject({ model: 'gpt-4o-mini', prompt: 'Check this.', schema })).rejects.toThrow(
      'OpenAI returned no parsed output',
    )
  })

  it('preserves provider errors', async () => {
    const providerError = new Error('openai parse failed')
    const schema = z.object({ ok: z.boolean() })
    const { client } = createOpenAIHelperFake(async () => {
      throw providerError
    })
    const generateObject = createGenerateObjectFn(client)

    await expect(generateObject({ model: 'gpt-4o-mini', prompt: 'Check this.', schema })).rejects.toBe(providerError)
  })

  it.each([undefined, null, 42, '', '   '])('rejects invalid model %j before OpenAI I/O', async (model) => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createOpenAIHelperFake(async () => ({
      choices: [{ message: { parsed: { ok: true } } }],
    }))
    const generateObject = createGenerateObjectFn(client)

    await expect(generateObject({ model, prompt: 'Check this.', schema })).rejects.toBeInstanceOf(TypeError)
    expect(calls).toHaveLength(0)
  })

  it.each<{
    readonly kind: string
    readonly part: ContentPart
    readonly expected?: unknown
  }>([
    {
      kind: 'image',
      part: { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      expected: { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    },
    {
      kind: 'audio',
      part: { type: 'audio', source: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' },
      expected: { type: 'input_audio', input_audio: { data: 'AQID', format: 'mp3' } },
    },
    {
      kind: 'video',
      part: { type: 'video', source: new URL('https://example.com/clip.mp4'), mediaType: 'video/mp4' },
    },
    {
      kind: 'file',
      part: {
        type: 'file',
        source: new Uint8Array([4, 5, 6]),
        mediaType: 'application/pdf',
        filename: 'report.pdf',
      },
      expected: {
        type: 'file',
        file: { file_data: 'data:application/pdf;base64,BAUG', filename: 'report.pdf' },
      },
    },
  ])('encodes or rejects canonical $kind content before OpenAI I/O', async ({ part, expected }) => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createOpenAIHelperFake(async () => ({
      choices: [{ message: { parsed: { ok: true } } }],
    }))
    const generateObject = createGenerateObjectFn(client)
    const operation = generateObject({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect this.' }, part] }],
      schema,
    })

    if (expected === undefined) {
      try {
        await operation
        throw new Error('expected unsupported canonical content')
      } catch (error) {
        expect(isUnsupportedCapabilityError(error)).toBe(true)
      }
      expect(calls).toHaveLength(0)
      return
    }

    await operation
    expect(calls[0]?.messages[0]?.content).toEqual([{ type: 'text', text: 'Inspect this.' }, expected])
    expect((calls[0]?.messages[0]?.content as readonly Record<string, unknown>[])[1]).not.toHaveProperty(
      'providerOptions',
    )
  })
})
