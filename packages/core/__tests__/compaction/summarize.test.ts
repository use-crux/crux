import { describe, it, expect } from 'vitest'
import { summarizeMessages, formatTranscript } from '../../compaction/summarize'
import type { Message } from '../../generation/messages'
import type { GenerateTextFn } from '../../compaction/types'
import { imagePart, textPart } from '../../content'

const sampleMessages: Message[] = [
  { role: 'user', content: 'What is the capital of France?' },
  { role: 'assistant', content: 'The capital of France is Paris.' },
  { role: 'user', content: 'What about Germany?' },
  { role: 'assistant', content: 'The capital of Germany is Berlin.' },
]

/** Mock generate that echoes a fixed summary. */
const mockGenerate: GenerateTextFn = async () => ({
  text: 'User asked about European capitals. France: Paris, Germany: Berlin.',
})

describe('formatTranscript', () => {
  it('formats messages as numbered transcript', () => {
    const result = formatTranscript(sampleMessages)
    expect(result).toContain('[1] user: What is the capital of France?')
    expect(result).toContain('[2] assistant: The capital of France is Paris.')
    expect(result).toContain('[3] user: What about Germany?')
    expect(result).toContain('[4] assistant: The capital of Germany is Berlin.')
  })

    it('handles empty array', () => {
    expect(formatTranscript([])).toBe('')
  })

  it('handles single message', () => {
    const result = formatTranscript([{ role: 'user', content: 'Hello' }])
    expect(result).toBe('[1] user: Hello')
  })

  it('projects multimodal messages without object coercion or raw base64', () => {
    const result = formatTranscript([
      {
        role: 'user',
        content: [textPart('Summarize this chart'), imagePart({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })],
      },
    ])

    expect(result).toContain('[1] user: Summarize this chart')
    expect(result).toContain('[image image/png 3B sha256:')
    expect(result).not.toContain('[object Object]')
    expect(result).not.toContain('AQID')
  })
})

describe('summarizeMessages', () => {
  it('returns summary from generate function', async () => {
    const result = await summarizeMessages({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
    })

    expect(result.summary).toBe('User asked about European capitals. France: Paris, Germany: Berlin.')
  })

    it('computes token metrics', async () => {
    const result = await summarizeMessages({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
    })

    expect(result.tokensBefore).toBeGreaterThan(0)
    expect(result.tokensAfter).toBeGreaterThan(0)
    expect(result.ratio).toBeGreaterThan(0)
    expect(result.ratio).toBeLessThanOrEqual(1)
  })

    it('returns empty result for empty messages', async () => {
    const result = await summarizeMessages({
      messages: [],
      generate: mockGenerate,
      model: 'test-model',
    })

    expect(result.summary).toBe('')
    expect(result.tokensBefore).toBe(0)
    expect(result.tokensAfter).toBe(0)
    expect(result.ratio).toBe(1)
  })

    it('passes focus areas to system prompt', async () => {
    let capturedSystem = ''
    const generate: GenerateTextFn = async (opts) => {
      capturedSystem = opts.system ?? ''
      return { text: 'summary' }
    }

    await summarizeMessages({
      messages: sampleMessages,
      generate,
      model: 'test-model',
      focus: ['decisions', 'tool_results'],
    })

    expect(capturedSystem).toContain('decisions')
    expect(capturedSystem).toContain('tool_results')
  })

    it('passes transcript as prompt', async () => {
    let capturedPrompt = ''
    const generate: GenerateTextFn = async (opts) => {
      capturedPrompt = opts.prompt
      return { text: 'summary' }
    }

    await summarizeMessages({
      messages: sampleMessages,
      generate,
      model: 'test-model',
    })

    expect(capturedPrompt).toContain('[1] user: What is the capital of France?')
    expect(capturedPrompt).toContain('[4] assistant:')
  })

    it('passes model through to generate', async () => {
    let capturedModel: unknown
    const generate: GenerateTextFn = async (opts) => {
      capturedModel = opts.model
      return { text: 'summary' }
    }

    await summarizeMessages({
      messages: sampleMessages,
      generate,
      model: 'my-custom-model',
    })

    expect(capturedModel).toBe('my-custom-model')
  })

    it('uses default maxTokens of 500', async () => {
    let capturedSystem = ''
    const generate: GenerateTextFn = async (opts) => {
      capturedSystem = opts.system ?? ''
      return { text: 'summary' }
    }

    await summarizeMessages({
      messages: sampleMessages,
      generate,
      model: 'test-model',
    })

    expect(capturedSystem).toContain('500')
  })

    it('respects custom maxTokens', async () => {
    let capturedSystem = ''
    const generate: GenerateTextFn = async (opts) => {
      capturedSystem = opts.system ?? ''
      return { text: 'summary' }
    }

    await summarizeMessages({
      messages: sampleMessages,
      generate,
      model: 'test-model',
      maxTokens: 200,
    })

    expect(capturedSystem).toContain('200')
  })
})
