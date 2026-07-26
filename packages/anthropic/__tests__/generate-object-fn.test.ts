import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { isUnsupportedCapabilityError, type ContentPart } from '@use-crux/core'
import { createGenerateObjectFn } from '../src'

interface AnthropicParseRequest {
  readonly model: string
  readonly system?: string
  readonly messages: readonly { readonly role: string; readonly content: unknown }[]
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
  it('uses each call model, sends the schema, and returns the parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createAnthropicHelperFake(async () => ({
      parsed_output: { ok: true },
    }))
    const generateObject = createGenerateObjectFn(client)

    const result = await generateObject({
      model: 'claude-sonnet-4-5-20250929',
      system: 'Return JSON.',
      prompt: 'Check this.',
      schema,
    })
    await generateObject({
      model: 'claude-haiku-4-5-20251001',
      prompt: 'Check this again.',
      schema,
    })

    expect(result).toEqual({ object: { ok: true } })
    expect(calls.map((call) => call.model)).toEqual([
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ])
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
            "name": "output",
            "schema": {
              "$schema": "https://json-schema.org/draft/2020-12/schema",
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
    const generateObject = createGenerateObjectFn(client)

    await expect(
      generateObject({ model: 'claude-sonnet-4-5-20250929', prompt: 'Check this.', schema }),
    ).rejects.toThrow(
      'Anthropic returned no parsed output',
    )
  })

  it('preserves provider errors', async () => {
    const providerError = new Error('anthropic parse failed')
    const schema = z.object({ ok: z.boolean() })
    const { client } = createAnthropicHelperFake(async () => {
      throw providerError
    })
    const generateObject = createGenerateObjectFn(client)

    await expect(
      generateObject({ model: 'claude-sonnet-4-5-20250929', prompt: 'Check this.', schema }),
    ).rejects.toBe(providerError)
  })

  it.each([undefined, null, 42, '', '   '])('rejects invalid model %j before Anthropic I/O', async (model) => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createAnthropicHelperFake(async () => ({ parsed_output: { ok: true } }))
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
      expected: { type: 'image', source: { type: 'base64', data: 'AQID', media_type: 'image/png' } },
    },
    {
      kind: 'audio',
      part: { type: 'audio', source: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' },
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
        type: 'document',
        source: { type: 'base64', data: 'BAUG', media_type: 'application/pdf' },
        title: 'report.pdf',
      },
    },
  ])('encodes or rejects canonical $kind content before Anthropic I/O', async ({ part, expected }) => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createAnthropicHelperFake(async () => ({ parsed_output: { ok: true } }))
    const generateObject = createGenerateObjectFn(client)
    const operation = generateObject({
      model: 'claude-sonnet-4-5-20250929',
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
      'cache_control',
    )
  })
})
