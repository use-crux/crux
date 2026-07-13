import { isRecord, stringValue } from './lifecycle-utils'

export function collectResultToolCalls(
  value: unknown,
): Array<{ id?: string; name: string; args: unknown }> {
  const calls: Array<{ id?: string; name: string; args: unknown }> = []
  appendResultToolCalls(calls, value)
  return calls
}

function appendResultToolCalls(
  target: Array<{ id?: string; name: string; args: unknown }>,
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
    target.push({
      id: stringValue(value.toolCallId) ?? stringValue(value.id),
      name,
      args: value.args ?? value.input ?? value.arguments,
    })
  }
  appendResultToolCalls(target, value.toolCalls)
  appendResultToolCalls(target, value.steps)
}
