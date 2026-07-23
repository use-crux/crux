import { describe, expect, it } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
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
  it('sends the schema to Google structured output and returns the parsed object', async () => {
    const schema = z.object({ ok: z.boolean() })
    const { calls, client } = createGoogleHelperFake(async () => ({ text: '{"ok":true}' }))
    const generateObject = createGenerateObjectFn(client, 'gemini-2.5-flash')

    const result = await generateObject({
      model: 'ignored-per-call-model',
      system: 'Return JSON.',
      prompt: 'Check this.',
      schema,
    })

    expect(result).toEqual({ object: { ok: true } })
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
    const generateObject = createGenerateObjectFn(client, 'gemini-2.5-flash')

    await expect(generateObject({ model: 'ignored', prompt: 'Check this.', schema })).rejects.toThrow()
  })

  it('preserves provider errors', async () => {
    const providerError = new Error('google generation failed')
    const schema = z.object({ ok: z.boolean() })
    const { client } = createGoogleHelperFake(async () => {
      throw providerError
    })
    const generateObject = createGenerateObjectFn(client, 'gemini-2.5-flash')

    await expect(generateObject({ model: 'ignored', prompt: 'Check this.', schema })).rejects.toBe(providerError)
  })
})
