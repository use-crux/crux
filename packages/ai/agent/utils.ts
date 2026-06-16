let execCounter = 0

/** Parse JSON strings when possible, returning the original string on failure. */
export function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Generate a process-local execution trace id for agent model-call middleware. */
export function generateExecTraceId(): string {
  execCounter += 1
  return `${Date.now()}-exec-${execCounter}-${Math.random().toString(36).slice(2, 8)}`
}
