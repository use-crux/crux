import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compileStructuredOutput } from '@use-crux/core/adapter'
import { googleRequest, googleSettings, googleStructuredCapabilities } from '../src/request'

describe('Google request settings', () => {
  it('maps portable reasoning effort to Google thinking config', () => {
    expect(googleSettings({ reasoning: 'low' })).toMatchObject({
      thinkingConfig: { thinkingLevel: 'LOW' },
    })
    expect(googleSettings({ reasoning: 'low' })).not.toHaveProperty('reasoning')
  })
})

describe('Google structured-output request', () => {
  const baseArgs = {
    model: 'gemini-2.0-flash',
    system: undefined,
    systemBlocks: undefined,
    messages: [],
    providerMessages: [],
    settings: {},
    schema: undefined,
    tools: undefined,
    extra: {},
  }

  // Minimal cached-content lifecycle stub (no cache) for request assembly.
  const cachedContent = {
    prepare: async () => ({ config: {} }),
  } as unknown as Parameters<typeof googleRequest>[1]

  it('places the core-compiled schema in config.responseJsonSchema', async () => {
    const schema = z.object({ ok: z.boolean() })
    const outputSchema = compileStructuredOutput(schema, googleStructuredCapabilities).outputSchema

    const request = await googleRequest({ ...baseArgs, schema, outputSchema }, cachedContent)
    const config = request.config as {
      responseMimeType?: string
      responseJsonSchema?: Record<string, unknown>
    }
    expect(config.responseMimeType).toBe('application/json')
    expect(config.responseJsonSchema).toMatchObject({ type: 'object' })
  })

  it('omits the structured config for a non-structured request', async () => {
    const request = await googleRequest({ ...baseArgs, outputSchema: undefined }, cachedContent)
    const config = request.config as Record<string, unknown>
    expect(config).not.toHaveProperty('responseJsonSchema')
  })
})
