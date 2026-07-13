/** Test-only image-operation support rows shared by first-party adapters and docs. */

export type ImageGenerationFixtureAdapter = 'ai-sdk' | 'anthropic' | 'convex' | 'google' | 'openai'

export interface ImageGenerationConformanceRow {
  readonly adapter: ImageGenerationFixtureAdapter
  readonly support: 'native' | 'exact-ai-re-export' | 'absent'
}

/** Frozen all-five parity expectation; this is not a runtime capability registry. */
export const IMAGE_GENERATION_CONFORMANCE = Object.freeze([
  Object.freeze({ adapter: 'ai-sdk', support: 'native' }),
  Object.freeze({ adapter: 'anthropic', support: 'absent' }),
  Object.freeze({ adapter: 'convex', support: 'exact-ai-re-export' }),
  Object.freeze({ adapter: 'google', support: 'native' }),
  Object.freeze({ adapter: 'openai', support: 'native' }),
] satisfies readonly ImageGenerationConformanceRow[])

/** Read one adapter expectation from the shared test fixture. */
export function imageGenerationConformanceRow(adapter: ImageGenerationFixtureAdapter): ImageGenerationConformanceRow {
  const row = IMAGE_GENERATION_CONFORMANCE.find((candidate) => candidate.adapter === adapter)
  if (!row) throw new Error(`Missing image generation conformance row for ${adapter}.`)
  return row
}

/** Markdown support projection consumed by the internal docs parity test. */
export function imageGenerationSupportProjection(): string {
  const label = (support: ImageGenerationConformanceRow['support']) =>
    support === 'native' ? 'native' : support === 'exact-ai-re-export' ? 'exact AI SDK re-export' : 'absent'
  return IMAGE_GENERATION_CONFORMANCE.map((row) => `| ${row.adapter} | ${label(row.support)} |`).join('\n')
}
