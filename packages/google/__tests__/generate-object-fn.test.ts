import { describe, expect, it } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import type { ContentPart } from '@use-crux/core'
import { createGenerateObjectFn } from '../src'

interface GoogleGenerateContentRequest {
  readonly model: string
  readonly contents: unknown
  readonly config?: {
    readonly systemInstruction?: string
    readonly responseMimeType?: string
    readonly responseJsonSchema?: unknown
  }
}

interface GoogleGenerateContentResponse {
  readonly text?: string
}

function createGoogleHelperFake(
  respond: (request: GoogleGenerateContentRequest) => Promise<GoogleGenerateContentResponse>,
) {
  const calls: GoogleGenerateContentRequest[] = []
  const fake = {
    models: {
      generateContent: async (request: GoogleGenerateContentRequest) => {
        calls.push(request)
        return respond(request)
      },
    },
  }

  return { calls, client: fake as unknown as GoogleGenAI }
}

function googleRequestShape(request: GoogleGenerateContentRequest | undefined) {
  return {
    model: request?.model,
    contents: request?.contents,
    config: request?.config,
  }
}

describe('createGenerateObjectFn', () => {
  it('uses each call model, sends the schema, and returns the parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createGoogleHelperFake(async () => ({ text: '{"ok":true}' }))
    const generateObject = createGenerateObjectFn(client)

    const result = await generateObject({
      model: 'gemini-2.5-flash',
      system: 'Return JSON.',
      prompt: 'Check this.',
      schema,
    })
    await generateObject({
      model: 'gemini-2.5-pro',
      prompt: 'Check this again.',
      schema,
    })

    expect(result).toEqual({ object: { ok: true } })
    expect(calls.map((call) => call.model)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
    expect(calls[0]).toMatchObject({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Check this.' }] }],
      config: {
        systemInstruction: 'Return JSON.',
        responseMimeType: 'application/json',
        responseJsonSchema: expect.objectContaining({ type: 'object' }),
      },
    })
    expect(googleRequestShape(calls[0])).toMatchInlineSnapshot(`
      {
        "config": {
          "responseJsonSchema": {
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
          "responseMimeType": "application/json",
          "systemInstruction": "Return JSON.",
        },
        "contents": [
          {
            "parts": [
              {
                "text": "Check this.",
              },
            ],
            "role": "user",
          },
        ],
        "model": "gemini-2.5-flash",
      }
    `)
  })

  it('throws when Google returns invalid JSON or an object that fails the schema', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { client } = createGoogleHelperFake(async () => ({ text: '{"ok":"not boolean"}' }))
    const generateObject = createGenerateObjectFn(client)

    await expect(generateObject({ model: 'gemini-2.5-flash', prompt: 'Check this.', schema })).rejects.toThrow()
  })

  it('preserves provider errors', async () => {
    const providerError = new Error('google generation failed')
    const schema = z.object({ ok: z.boolean() })
    const { client } = createGoogleHelperFake(async () => {
      throw providerError
    })
    const generateObject = createGenerateObjectFn(client)

    await expect(generateObject({ model: 'gemini-2.5-flash', prompt: 'Check this.', schema })).rejects.toBe(providerError)
  })

  it.each([undefined, null, 42, '', '   '])('rejects invalid model %j before Google I/O', async (model) => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createGoogleHelperFake(async () => ({ text: '{"ok":true}' }))
    const generateObject = createGenerateObjectFn(client)

    await expect(generateObject({ model, prompt: 'Check this.', schema })).rejects.toBeInstanceOf(TypeError)
    expect(calls).toHaveLength(0)
  })

  it.each<{
    readonly kind: string
    readonly part: ContentPart
    readonly expected: unknown
  }>([
    {
      kind: 'image URL',
      part: { type: 'image', source: new URL('https://example.com/image.png'), mediaType: 'image/png' },
      expected: {
        fileData: { fileUri: 'https://example.com/image.png', mimeType: 'image/png' },
      },
    },
    {
      kind: 'audio bytes',
      part: { type: 'audio', source: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' },
      expected: { inlineData: { data: 'AQID', mimeType: 'audio/mpeg' } },
    },
    {
      kind: 'video bytes',
      part: { type: 'video', source: new Uint8Array([4, 5, 6]), mediaType: 'video/mp4' },
      expected: { inlineData: { data: 'BAUG', mimeType: 'video/mp4' } },
    },
    {
      kind: 'provider file',
      part: {
        type: 'file',
        source: {
          type: 'provider-file',
          provider: 'google',
          fileId: 'google-file-fixture',
          mediaType: 'application/pdf',
          filename: 'report.pdf',
        },
      },
      expected: {
        fileData: {
          fileUri: 'google-file-fixture',
          mimeType: 'application/pdf',
          displayName: 'report.pdf',
        },
      },
    },
  ])('encodes canonical $kind with stable order and metadata', async ({ part, expected }) => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createGoogleHelperFake(async () => ({ text: '{"ok":true}' }))
    const generateObject = createGenerateObjectFn(client)

    await generateObject({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect this.' }, part] }],
      schema,
    })

    const contents = calls[0]?.contents as readonly { readonly parts: readonly Record<string, unknown>[] }[]
    expect(contents[0]?.parts).toEqual([{ text: 'Inspect this.' }, expected])
    expect(contents[0]?.parts[1]).not.toHaveProperty('mediaResolution')
  })
})
