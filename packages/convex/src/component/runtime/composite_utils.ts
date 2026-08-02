import type { RuntimeWorkState } from '@use-crux/core/runtime'

export function unsupported<TArgs extends readonly unknown[], TResult>(
  name: string,
): (...args: TArgs) => Promise<TResult> {
  return (async () => {
    throw new Error(`Runtime composite body unexpectedly called ${name}.`)
  }) as (...args: TArgs) => Promise<TResult>
}

export function cleanDoc(record: Record<string, unknown>): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = record
  void _id
  void _creationTime
  return rest
}

export function clean<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T
}

export function statusAllowed(
  status: string,
  from: RuntimeWorkState | readonly RuntimeWorkState[] | undefined,
): boolean {
  if (from === undefined) return status === 'suspended'
  return Array.isArray(from) ? from.includes(status as RuntimeWorkState) : status === from
}
