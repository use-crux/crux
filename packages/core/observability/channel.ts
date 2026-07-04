import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  type CruxGraphRecord,
} from './contract'

/** The standard Node diagnostics channel that receives Crux graph records. */
export const CRUX_OBSERVABILITY_CHANNEL = 'crux:observability'

/** Message published for each record on `CRUX_OBSERVABILITY_CHANNEL`. */
export interface CruxObservabilityChannelMessage {
  /** The graph contract version used by the published record. */
  readonly schemaVersion: typeof CRUX_OBSERVABILITY_SCHEMA_VERSION
  /** The canonical Crux observability graph record. */
  readonly record: CruxGraphRecord
}

interface DiagnosticsChannelLike {
  readonly hasSubscribers: boolean
  publish(message: CruxObservabilityChannelMessage): void
}

interface DiagnosticsChannelModuleLike {
  channel(name: string): DiagnosticsChannelLike
  hasSubscribers?(name: string): boolean
}

let observabilityChannel: DiagnosticsChannelLike | null | undefined
let diagnosticsChannelModule: DiagnosticsChannelModuleLike | null | undefined
let diagnosticsChannelImportStarted = false

export function publishObservabilityChannel(record: CruxGraphRecord): void {
  const diagnostics = getDiagnosticsChannelModule()
  if (!diagnostics) return
  if (diagnostics.hasSubscribers && !diagnostics.hasSubscribers(CRUX_OBSERVABILITY_CHANNEL)) return

  const channel = getObservabilityChannel(diagnostics)
  if (!diagnostics.hasSubscribers && !channel.hasSubscribers) return
  try {
    channel.publish({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      record,
    })
  } catch {
    // Diagnostics-channel subscribers are external observers; failures must
    // never interrupt Crux runtime execution or transport delivery.
  }
}

/** Returns whether the Crux diagnostics channel currently has subscribers. */
export function channelHasSubscribers(): boolean {
  const diagnostics = getDiagnosticsChannelModule()
  if (!diagnostics) return false
  if (diagnostics.hasSubscribers) return diagnostics.hasSubscribers(CRUX_OBSERVABILITY_CHANNEL)
  return getObservabilityChannel(diagnostics).hasSubscribers
}

function getObservabilityChannel(diagnostics: DiagnosticsChannelModuleLike): DiagnosticsChannelLike {
  if (observabilityChannel) return observabilityChannel
  observabilityChannel = diagnostics.channel(CRUX_OBSERVABILITY_CHANNEL)
  return observabilityChannel
}

function getDiagnosticsChannelModule(): DiagnosticsChannelModuleLike | null {
  if (diagnosticsChannelModule !== undefined) return diagnosticsChannelModule
  try {
    // `process.getBuiltinModule` works in BOTH module systems (Node >= 20.16);
    // bare `require` only exists in CJS. Keep `require` as the CJS fallback
    // and degrade to no-op in edge-like runtimes where neither is available.
    const getBuiltinModule = (
      globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
    ).process?.getBuiltinModule
    const diagnostics = (getBuiltinModule?.('node:diagnostics_channel') ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('node:diagnostics_channel')) as DiagnosticsChannelModuleLike
    diagnosticsChannelModule = diagnostics
  } catch {
    diagnosticsChannelModule = null
    preloadDiagnosticsChannelModule()
  }
  return diagnosticsChannelModule
}

function preloadDiagnosticsChannelModule(): void {
  if (diagnosticsChannelImportStarted) return
  diagnosticsChannelImportStarted = true
  void import('node:diagnostics_channel')
    .then((diagnostics) => {
      if (diagnosticsChannelModule === null) {
        diagnosticsChannelModule = diagnostics as DiagnosticsChannelModuleLike
      }
    })
    .catch(() => {
      diagnosticsChannelModule = null
    })
}
