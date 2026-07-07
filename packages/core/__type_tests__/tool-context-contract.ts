/**
 * Compile-time contract for typed tool context.
 *
 * These tests exercise the public authoring and adapter option surfaces: a
 * tool's `contextSchema` controls the `execute` context type, and known tool
 * maps make `toolsContext` conditionally required at generation call sites.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { tool } from '../tools/define-tool'
import { prompt } from '../prompt/prompt'
import type { AdapterGenerateOptions } from '../adapter/define-adapter'

const weather = tool({
  name: 'weather',
  description: 'Get current weather',
  input: z.object({ city: z.string() }),
  contextSchema: z.object({ apiKey: z.string(), region: z.enum(['eu', 'us']).optional() }),
  execute: async ({ city }, { context, runtimeContext, toolCallId }) => {
    expectTypeOf(city).toEqualTypeOf<string>()
    expectTypeOf(context).toEqualTypeOf<{ apiKey: string; region?: 'eu' | 'us' | undefined }>()
    expectTypeOf(runtimeContext).toEqualTypeOf<unknown>()
    expectTypeOf(toolCallId).toEqualTypeOf<string>()
    return context.apiKey
  },
})

const ping = tool({
  name: 'ping',
  description: 'Ping without declared context',
  execute: (_input, options) => {
    // @ts-expect-error tools without contextSchema do not receive a context field
    options.context
    return 'pong'
  },
})

const assistantPrompt = prompt({
  id: 'tool-context-contract',
  tools: { weather },
  prompt: 'Use the tool.',
})

type WeatherTools = { readonly weather: typeof weather }
type PingTools = { readonly ping: typeof ping }

const weatherOptions = {
  model: 'model',
  tools: { weather },
  toolsContext: { weather: { apiKey: 'secret' } },
} satisfies AdapterGenerateOptions<Record<string, unknown>, WeatherTools>

expectTypeOf(weatherOptions.toolsContext.weather.apiKey).toEqualTypeOf<string>()

const _missingToolsContext = {
  model: 'model',
  tools: { weather },
// @ts-expect-error weather declares contextSchema, so toolsContext is required
} satisfies AdapterGenerateOptions<Record<string, unknown>, WeatherTools>

const _promptToolContext = {
  model: 'model',
  toolsContext: { weather: { apiKey: 'secret' } },
} satisfies AdapterGenerateOptions<Record<string, unknown>, undefined, typeof assistantPrompt>

const _wrongToolKey = {
  model: 'model',
  tools: { weather },
  // @ts-expect-error the mapped key must match the tool name
  toolsContext: { other: { apiKey: 'secret' } },
} satisfies AdapterGenerateOptions<Record<string, unknown>, WeatherTools>

const _wrongToolContextShape = {
  model: 'model',
  tools: { weather },
  toolsContext: {
    // @ts-expect-error context value must satisfy weather.contextSchema
    weather: { apiKey: 123 },
  },
} satisfies AdapterGenerateOptions<Record<string, unknown>, WeatherTools>

const _noSchemaNoToolsContext = {
  model: 'model',
  tools: { ping },
} satisfies AdapterGenerateOptions<Record<string, unknown>, PingTools>

const _unexpectedToolsContext = {
  model: 'model',
  tools: { ping },
  // @ts-expect-error tools without contextSchema do not accept toolsContext
  toolsContext: { ping: {} },
} satisfies AdapterGenerateOptions<Record<string, unknown>, PingTools>

const _typedApprovalRuntimeContext = {
  model: 'model',
  tools: { weather },
  toolsContext: { weather: { apiKey: 'secret' } },
  runtimeContext: { tenantId: 'tenant_1' },
  toolApproval: {
    weather: (ctx) => {
      expectTypeOf(ctx.runtimeContext).toEqualTypeOf<{ tenantId: string }>()
      return ctx.runtimeContext.tenantId === 'tenant_1'
    },
  },
} satisfies AdapterGenerateOptions<
  Record<string, unknown>,
  WeatherTools,
  undefined,
  { tenantId: string }
>
