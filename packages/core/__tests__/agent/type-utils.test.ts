import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../prompt/prompt'
import { agent as makeAgent } from '../../agent/agent'
import type { InferAgentInput, InferAgentOutput } from '../../agent'

// ── Test agents with typed schemas ──────────────────────────────

const researchPrompt = makePrompt({
  id: 'test-research',
  input: z.object({ query: z.string(), maxResults: z.number().optional() }),
  output: z.object({ sources: z.array(z.string()), synthesis: z.string() }),
  system: 'Research agent',
})

const textPrompt = makePrompt({
  id: 'test-text',
  input: z.object({ topic: z.string() }),
  system: 'Text agent (no output schema)',
})

const researcher = makeAgent({ id: 'researcher', prompt: researchPrompt })
const textAgent = makeAgent({ id: 'text-agent', prompt: textPrompt })

// ── Type-level tests ────────────────────────────────────────────
// These tests verify that the utility types extract correct types.
// They compile-time check via type assignments and runtime verify via dummy values.

describe('InferAgentInput', () => {
  it('extracts input type from agent with typed prompt', () => {
    // This assignment would fail at compile time if InferAgentInput is wrong
    const input: InferAgentInput<typeof researcher> = {
      query: 'AI safety',
      maxResults: 10,
    }
    expect(input.query).toBe('AI safety')
  })

  it('extracts input type from text-mode agent', () => {
    const input: InferAgentInput<typeof textAgent> = {
      topic: 'TypeScript',
    }
    expect(input.topic).toBe('TypeScript')
  })
})

describe('InferAgentOutput', () => {
  it('extracts output type from agent with output schema', () => {
    // This assignment would fail at compile time if InferAgentOutput is wrong
    const output: InferAgentOutput<typeof researcher> = {
      sources: ['source1', 'source2'],
      synthesis: 'AI safety is important',
    }
    expect(output.sources).toHaveLength(2)
  })

  it('infers string for text-mode agents (no output schema)', () => {
    const output: InferAgentOutput<typeof textAgent> = 'some text output'
    expect(typeof output).toBe('string')
  })
})
