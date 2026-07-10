/**
 * Source-location helpers for authored Crux definitions.
 *
 * Prompt/context/flow definitions use `captureSource()` to record authored
 * source metadata for the Project Index contract.
 *
 * @module
 */

/** Capture the call-site from the current stack trace. */
export function captureSource(): { file: string; line: number; column?: number; function?: string } | undefined {
  const stack = new Error().stack
  if (!stack) return undefined

  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.includes('index/source')) continue
    if (line.includes('node_modules')) continue

    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/)
    if (match) {
      return {
        file: match[2]!,
        line: parseInt(match[3]!, 10),
        column: parseInt(match[4]!, 10),
        ...(match[1] ? { function: match[1] } : {}),
      }
    }
  }

  return undefined
}
