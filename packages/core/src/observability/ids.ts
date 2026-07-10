import type {
  CruxArtifactId,
  CruxEdgeId,
  CruxRecordId,
  CruxRunId,
  CruxSpanEventId,
  CruxSpanId,
  CruxTraceId,
} from './contract'

let recordCounter = 0
let warnedAboutWeakRandom = false

/**
 * Create a W3C trace identifier for a Crux observability graph.
 *
 * Trace IDs are 32 lowercase hexadecimal characters and never the all-zero
 * value rejected by the W3C Trace Context specification.
 */
export function createCruxTraceId(): CruxTraceId {
  return randomNonZeroHex(16) as CruxTraceId
}

/**
 * Create a W3C span identifier for a Crux observability graph.
 *
 * Span IDs are 16 lowercase hexadecimal characters and never the all-zero
 * value rejected by the W3C Trace Context specification.
 */
export function createCruxSpanId(): CruxSpanId {
  return randomNonZeroHex(8) as CruxSpanId
}

/**
 * Create a run identifier with the stable Crux run prefix.
 *
 * The suffix is 24 lowercase hexadecimal characters so it stays compact while
 * remaining URL/log friendly and independent from trace identity.
 */
export function createCruxRunId(): CruxRunId {
  return `run_${randomNonZeroHex(12)}` as CruxRunId
}

/**
 * Create a record identifier with a random component plus process-local order.
 *
 * The monotonic suffix helps make record IDs easy to scan during debugging; it
 * is not used as the graph ordering contract. Use `seq` for per-run ordering.
 */
export function createCruxRecordId(): CruxRecordId {
  recordCounter += 1
  return `rec_${randomNonZeroHex(8)}_${recordCounter.toString(36)}` as CruxRecordId
}

/** Create an event identifier with the stable Crux event prefix. */
export function createCruxSpanEventId(): CruxSpanEventId {
  return `event_${randomNonZeroHex(8)}` as CruxSpanEventId
}

/** Create an edge identifier with the stable Crux edge prefix. */
export function createCruxEdgeId(): CruxEdgeId {
  return `edge_${randomNonZeroHex(8)}` as CruxEdgeId
}

/** Create an artifact identifier with the stable Crux artifact prefix. */
export function createCruxArtifactId(): CruxArtifactId {
  return `artifact_${randomNonZeroHex(8)}` as CruxArtifactId
}

function randomNonZeroHex(byteLength: number): string {
  let value = ''
  do {
    value = bytesToHex(randomBytes(byteLength))
  } while (isAllZeroHex(value))
  return value
}

function randomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }

  warnAboutWeakRandomOnce()
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isAllZeroHex(value: string): boolean {
  return /^0+$/.test(value)
}

function warnAboutWeakRandomOnce(): void {
  if (warnedAboutWeakRandom) return
  warnedAboutWeakRandom = true
  if (!shouldWarnAboutWeakRandom()) return
  console.warn('[crux] crypto.getRandomValues is unavailable; observability IDs are using Math.random fallback.')
}

function shouldWarnAboutWeakRandom(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  const nodeEnv = runtime.process?.env?.NODE_ENV
  return nodeEnv !== 'production' && nodeEnv !== 'test'
}
