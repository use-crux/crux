import { isRecord, stringValue } from './lifecycle-utils'

export function collectResultToolCalls(
  value: unknown,
): Array<{ id?: string; name: string; args: unknown; result?: unknown; error?: string }> {
  const calls: Array<{ id?: string; name: string; args: unknown; result?: unknown; error?: string }> = []
  appendResultToolCalls(calls, value)
  return calls
}

function appendResultToolCalls(
  target: Array<{ id?: string; name: string; args: unknown; result?: unknown; error?: string }>,
  value: unknown,
): void {
  if (!value) return
  if (Array.isArray(value)) {
    for (const item of value) appendResultToolCalls(target, item)
    return
  }
  if (!isRecord(value)) return
  const name = stringValue(value.toolName) ?? stringValue(value.name)
  if (name) {
    const id = stringValue(value.toolCallId) ?? stringValue(value.id)
    const existing = id ? target.find((call) => call.id === id) : undefined
    const call = existing ?? {
      id,
      name,
      args: value.args ?? value.input ?? value.arguments,
    }
    if (Object.hasOwn(value, 'output')) call.result = value.output
    if (Object.hasOwn(value, 'error')) call.error = toolErrorText(value.error)
    if (!existing) target.push(call)
  }
  appendResultToolCalls(target, value.toolCalls)
  appendResultToolCalls(target, value.toolResults)
  appendResultToolCalls(target, value.steps)
  appendResultToolCalls(target, value.content)
}

function toolErrorText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.message === 'string') return value.message
  try {
    const serialized = JSON.stringify(value)
    if (serialized !== undefined) return serialized
  } catch {
    // Fall back to String() for circular, bigint, and other non-JSON values.
  }
  return String(value)
}
