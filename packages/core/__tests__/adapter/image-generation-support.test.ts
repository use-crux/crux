import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IMAGE_GENERATION_CONFORMANCE, imageGenerationSupportProjection, mediaAdapterMatrixMarkdown } from '../../src/adapter/testing'

describe('image generation support projection', () => {
  it('projects the tested five-adapter fixture without a runtime capability API', () => {
    expect(IMAGE_GENERATION_CONFORMANCE).toHaveLength(5)
    expect(imageGenerationSupportProjection()).toBe([
      '| ai-sdk | native |',
      '| anthropic | absent |',
      '| convex | exact AI SDK re-export |',
      '| google | native |',
      '| openai | native |',
    ].join('\n'))
  })

  it('keeps the public media matrix generated from tested fixtures', async () => {
    const guide = await readFile(resolve(process.cwd(), '../../apps/docs/content/docs/guides/advanced/multimodal.mdx'), 'utf8')
    expect(guide).toContain(mediaAdapterMatrixMarkdown())
  })
})
