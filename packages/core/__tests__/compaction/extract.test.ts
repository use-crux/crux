import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { extractKeyFacts } from '../../compaction/extract'
import type { Message } from '../../generation/messages'
import type { GenerateObjectFn } from '../../compaction/types'

const sampleMessages: Message[] = [
  {
    role: 'user',
    content: 'I prefer concise writing. No exclamation marks please.',
  },
  {
    role: 'assistant',
    content: 'Understood. I will keep responses brief and avoid exclamation marks.',
  },
  { role: 'user', content: 'The target audience is enterprise CTOs.' },
]

describe('extractKeyFacts', () => {
  it('returns structured output from generate function', async () => {
    const schema = z.object({
      facts: z.array(
        z.object({
          fact: z.string(),
          category: z.enum(['preference', 'constraint', 'context']),
        }),
      ),
    })

    const mockGenerate: GenerateObjectFn = async () => ({
      object: {
        facts: [
          { fact: 'User prefers concise writing', category: 'preference' },
          { fact: 'No exclamation marks', category: 'constraint' },
          { fact: 'Target audience: enterprise CTOs', category: 'context' },
        ],
      },
    })

    const result = await extractKeyFacts({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
      schema,
    })

    expect(result.facts).toHaveLength(3)
    expect(result.facts[0].fact).toBe('User prefers concise writing')
    expect(result.facts[0].category).toBe('preference')
  })

    it('passes model through to generate', async () => {
    let capturedModel: unknown
    const mockGenerate: GenerateObjectFn = async (opts) => {
      capturedModel = opts.model
      return { object: { items: [] } }
    }

    const schema = z.object({ items: z.array(z.string()) })

    await extractKeyFacts({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'special-model',
      schema,
    })

    expect(capturedModel).toBe('special-model')
  })

    it('passes schema through to generate', async () => {
    let capturedSchema: unknown
    const mockGenerate: GenerateObjectFn = async (opts) => {
      capturedSchema = opts.schema
      return { object: { items: [] } }
    }

    const schema = z.object({ items: z.array(z.string()) })

    await extractKeyFacts({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
      schema,
    })

    expect(capturedSchema).toBe(schema)
  })

    it('includes conversation transcript in prompt', async () => {
    let capturedPrompt = ''
    const mockGenerate: GenerateObjectFn = async (opts) => {
      capturedPrompt = opts.prompt
      return { object: { items: [] } }
    }

    const schema = z.object({ items: z.array(z.string()) })

    await extractKeyFacts({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
      schema,
    })

    expect(capturedPrompt).toContain('concise writing')
    expect(capturedPrompt).toContain('enterprise CTOs')
  })

    it('sets system prompt for extraction', async () => {
    let capturedSystem = ''
    const mockGenerate: GenerateObjectFn = async (opts) => {
      capturedSystem = opts.system ?? ''
      return { object: { items: [] } }
    }

    const schema = z.object({ items: z.array(z.string()) })

    await extractKeyFacts({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
      schema,
    })

    expect(capturedSystem).toContain('extraction')
  })

    it('works with simple schema', async () => {
    const schema = z.object({
      summary: z.string(),
      keyPoints: z.array(z.string()),
    })

    const mockGenerate: GenerateObjectFn = async () => ({
      object: {
        summary: 'User wants concise writing for CTOs',
        keyPoints: ['concise', 'no exclamation marks', 'enterprise CTOs'],
      },
    })

    const result = await extractKeyFacts({
      messages: sampleMessages,
      generate: mockGenerate,
      model: 'test-model',
      schema,
    })

    expect(result.summary).toBe('User wants concise writing for CTOs')
    expect(result.keyPoints).toHaveLength(3)
  })
})
