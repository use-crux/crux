type MediaTokenInput = Readonly<{
  model: string
  media: Readonly<{
    kind: 'image' | 'file'
    width?: number
    height?: number
  }>
}>

// https://docs.anthropic.com/en/docs/build-with-claude/vision
// Verified 2026-07-11: non-resized images are approximately width*height/750 tokens.
export function estimateAnthropicMediaTokens(input: MediaTokenInput): number | undefined {
  const { media, model } = input
  if (media.kind !== 'image' || !/^claude-(?:3|(?:haiku|sonnet|opus)-4)/.test(model)) return undefined
  if (!positive(media.width) || !positive(media.height)) return undefined
  const pixels = media.width * media.height
  if (!Number.isSafeInteger(pixels)) return undefined
  return Math.ceil(pixels / 750)
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}
