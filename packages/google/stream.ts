/** Extract a text delta from a Google GenAI stream chunk. */
export function googleTextDelta(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !Array.isArray(chunk.candidates)) return undefined
  const candidate = chunk.candidates[0]
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return undefined
  }
  const firstPart = candidate.content.parts[0]
  if (!isRecord(firstPart)) return undefined
  return typeof firstPart.text === 'string' ? firstPart.text : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
