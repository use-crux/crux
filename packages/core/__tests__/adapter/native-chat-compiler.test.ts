/**
 * The native-chat compiler should turn provider wire-format hooks
 * into the `AdapterSpec` contract without profiles restating Crux choreography.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { adapter } from '../../src/adapter/define-adapter'
import { adapterSpecConformance } from '../../src/adapter/testing'
import type { AdapterConformanceHarness } from '../../src/adapter/testing'
import { prompt } from '../../src/prompt/prompt'
import { boundary, guardrail } from '../../src/safety'
import {
  bindNativeTest,
  inspectorFor,
  nativeTestProfile,
  type NativeTestClient,
  type NativeTestRawResponse,
  type NativeTestStream,
} from './native-chat-fixtures'

describe('native-chat compiler', () => {
  it('compiles a profile into a conforming AdapterSpec', async () => {
    const spec = nativeTestProfile.specFor(bindNativeTest)
    const harness: AdapterConformanceHarness<
      NativeTestClient,
      NativeTestRawResponse,
      NativeTestStream
    > = {
      prepare: (script) => {
        const client: NativeTestClient = { script, calls: [], streams: [] }
        return {
          client,
          model: 'native-test-model',
          inspect: inspectorFor(client),
        }
      },
    }

    const violations = await adapterSpecConformance(spec, harness)

    expect(violations).toEqual([])
  })

  it('gates structured object + text over the live native stream', async () => {
    const client: NativeTestClient = {
      script: { streamChunks: ['{"name":"ra', 'w"}'] },
      calls: [],
      streams: [],
    }
    const runtime = adapter(nativeTestProfile.specFor(bindNativeTest))(client)
    const seen: string[] = []
    const structured = prompt({
      id: 'native-structured-stream',
      prompt: 'json',
      output: z.object({ name: z.string() }),
    })
    const handle = await runtime.stream(structured, {
      model: 'native-test-model',
      guardrails: [
        guardrail({
          id: 'obj',
          on: boundary.output.object<{ name: string }>().path('name'),
          run: () => ({
            action: 'rewrite',
            value: 'X',
            rewrite: { kind: 'redact' },
          }),
        }),
        guardrail({
          id: 'text',
          on: boundary.output.text(),
          run: (text: string) => {
            seen.push(text)
            return { action: 'allow' as const }
          },
        }),
      ],
    })
    let streamed = ''
    for await (const chunk of handle.textStream) streamed += chunk
    const meta = await handle.completion

    expect(streamed).toBe('{"name":"X"}')
    expect(seen.join('')).toContain('{"name":"X"}')
    expect(seen.join('')).not.toContain('raw')
    expect(meta.object).toEqual({ name: 'X' })
  })
})
