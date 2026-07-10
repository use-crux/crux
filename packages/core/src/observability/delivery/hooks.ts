import type { CruxObservabilityTransport } from '../transport'

export type TransportHook = 'flush' | 'shutdown'

/** Run an optional transport lifecycle hook and return any thrown failure. */
export async function runTransportHook(
  transport: CruxObservabilityTransport | undefined,
  hook: TransportHook,
): Promise<unknown | undefined> {
  const runHook = hook === 'flush' ? transport?.flush : transport?.shutdown
  if (!runHook) return undefined

  try {
    await runHook.call(transport)
    return undefined
  } catch (error) {
    return error
  }
}
