/**
 * Devtools observability bridge for the standalone Quality runner.
 *
 * The runner loads the project's own `@use-crux/core` instance to avoid the
 * dual-package hazard. These helpers therefore accept the small structural
 * subset of that internal runner module needed to install and flush the
 * canonical HTTP observability transport.
 *
 * @module
 */

export interface QualityRunnerObservabilityCore<TTransport> {
  /** Return the currently configured observability transport, if any. */
  currentObservabilityTransport(): TTransport | undefined
  /** Create the core HTTP transport pointed at a local devtools origin. */
  createHttpObservabilityTransport(options: { readonly serverUrl?: string }): TTransport
  /** Install a transport and return the matching cleanup callback. */
  setObservabilityTransport(transport: TTransport | undefined): () => void
}

export interface QualityRunnerFlushCore {
  /** Core observability facade used to flush pending graph delivery. */
  observe: {
    flush(options?: { readonly timeoutMs?: number }): Promise<boolean>
  }
}

/** Normalized loopback devtools origin accepted for Quality auto-attach. */
type LocalDevtoolsUrl = string & { readonly __brand: 'LocalDevtoolsUrl' }

/**
 * Normalize an optional devtools URL into the local-only origin that the
 * Quality runner is allowed to auto-attach to.
 *
 * This guard keeps `CRUX_DEVTOOLS_URL` useful for `crux dev` while avoiding a
 * quiet telemetry/export channel to remote hosts. Explicit project
 * observability config remains the surface for non-local transports.
 */
function normalizeLocalDevtoolsUrl(serverUrl: string | undefined): LocalDevtoolsUrl | undefined {
  const input = serverUrl?.trim()
  if (!input) return undefined

  let url: URL
  try {
    url = new URL(normalizeDevtoolsProtocol(input))
  } catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') return undefined
  if (!isLoopbackHostname(url.hostname)) return undefined

  return `${url.protocol}//${url.host}` as LocalDevtoolsUrl
}

function normalizeDevtoolsProtocol(serverUrl: string): string {
  if (serverUrl.startsWith('ws://')) return `http://${serverUrl.slice('ws://'.length)}`
  if (serverUrl.startsWith('wss://')) return `https://${serverUrl.slice('wss://'.length)}`
  return serverUrl
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  return isIPv4Loopback(normalized)
}

function isIPv4Loopback(hostname: string): boolean {
  const parts = hostname.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => {
      if (!/^\d{1,3}$/u.test(part)) return false
      const value = Number(part)
      return value >= 0 && value <= 255
    })
  )
}

/**
 * Install devtools graph ingestion for quality runs when the Go CLI has found
 * a local devtools server. Existing project observability config wins, and
 * non-local URLs are ignored rather than creating implicit production
 * telemetry.
 */
export function enableQualityRunnerObservability<TTransport>(
  core: QualityRunnerObservabilityCore<TTransport>,
  serverUrl: string | undefined,
): (() => void) | undefined {
  const localServerUrl = normalizeLocalDevtoolsUrl(serverUrl)
  if (localServerUrl === undefined) return undefined
  if (core.currentObservabilityTransport() !== undefined) return undefined

  const transport = core.createHttpObservabilityTransport({ serverUrl: localServerUrl })
  return core.setObservabilityTransport(transport)
}

/**
 * Drain graph delivery best-effort before the worker process exits.
 *
 * Local devtools delivery must never change the Quality run result: a dead
 * local server or tunnel is a visibility miss, not an eval execution failure.
 */
export async function flushQualityRunnerObservability(core: QualityRunnerFlushCore, timeoutMs = 2_000): Promise<void> {
  try {
    await core.observe.flush({ timeoutMs })
  } catch {
    // Local devtools auto-attach is best-effort. Keep stdout NDJSON and exit
    // code owned by Quality collection/execution, not by observability flush.
  }
}
