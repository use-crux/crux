type MediaTokenInput = Readonly<{
  model: string
  media: Readonly<{
    mediaType?: string
    durationInSeconds?: number
  }>
}>

// https://ai.google.dev/gemini-api/docs/audio
// Verified 2026-07-11: Gemini audio input uses 32 tokens per second.
export function estimateGoogleMediaTokens(input: MediaTokenInput): number | undefined {
  const { media, model } = input
  if (!/^gemini-/.test(model) || !media.mediaType?.startsWith('audio/')) return undefined
  const duration = media.durationInSeconds
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) return undefined
  const estimate = Math.ceil(duration * 32)
  return Number.isSafeInteger(estimate) ? estimate : undefined
}
