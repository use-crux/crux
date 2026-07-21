import type {
  CruxMemoryCaptureAttributes,
  CruxMemoryCaptureStartAttributes,
} from '../../observability'
import { observe } from '../../observability'
import { memoryDefinitionRef } from '../../observability/definition-ref'
import type { MemoryCaptureMode } from '../block-contracts'
import type { MemoryCaptureSchedulingResult } from './scheduling'

type CaptureOperation = CruxMemoryCaptureAttributes['operation']
type CaptureDisposition = CruxMemoryCaptureAttributes['disposition']

/** Immutable inputs known when one capture lifecycle is accepted. */
export interface MemoryCaptureObservationOptions {
  readonly memoryId: string
  readonly operation: CaptureOperation
  readonly requestedMode: MemoryCaptureMode
  readonly sequence: number
  readonly blockCount: number
  readonly toolEventCount: number
}

/** Internal lifecycle handle for one payload-free `memory.capture` span. */
export interface MemoryCaptureObservation {
  withContext<T>(work: () => T | Promise<T>): T | Promise<T>
  setDisposition(status: MemoryCaptureSchedulingResult['status']): void
  complete(status: MemoryCaptureSchedulingResult['status']): void
  fail(error: unknown): void
}

/**
 * Start one canonical memory-capture observation in the active Run.
 *
 * The span never creates an implicit Run and records only stable identity,
 * closed lifecycle enums, and bounded counts. Capture payloads and raw errors
 * are intentionally excluded from every record.
 */
export function startMemoryCaptureObservation(
  options: MemoryCaptureObservationOptions,
): MemoryCaptureObservation {
  const span = observe.openSpan({
    name: 'memory.capture',
    primitive: 'memory.capture',
    implicitRun: false,
    definitionRefs: [memoryDefinitionRef(options.memoryId)],
    attributes: initialAttributes(options),
  })
  let disposition: CaptureDisposition | undefined

  const observation: MemoryCaptureObservation = {
    withContext: <T>(work: () => T | Promise<T>) => span.withContext(work),
    setDisposition(status) {
      disposition = captureDisposition(options.requestedMode, status)
      span.setAttributes({ disposition })
    },
    complete(status) {
      const outcome = status === 'captured' ? 'captured' : 'completed'
      span.end({
        attributes: {
          disposition:
            disposition ?? captureDisposition(options.requestedMode, status),
          outcome,
        },
      })
    },
    fail(error) {
      span.end({
        status: 'error',
        attributes: {
          ...(disposition ? { disposition } : {}),
          outcome: 'failed',
          ...machineCodeAttributes(error),
        },
      })
    },
  }
  return Object.freeze(observation)
}

function initialAttributes(
  options: MemoryCaptureObservationOptions,
): CruxMemoryCaptureStartAttributes {
  return {
    memoryId: options.memoryId,
    operation: options.operation,
    requestedMode: options.requestedMode,
    sequence: options.sequence,
    blockCount: options.blockCount,
    toolEventCount: options.toolEventCount,
  }
}

function captureDisposition(
  requestedMode: MemoryCaptureMode,
  status: MemoryCaptureSchedulingResult['status'],
): CaptureDisposition {
  if (status === 'captured') return 'eval-captured'
  if (status === 'deferred') return 'retained'
  return requestedMode === 'inline' ? 'inline' : 'inline-fallback'
}

function machineCodeAttributes(error: unknown): { readonly code?: string } {
  if (!error || typeof error !== 'object' || !('code' in error)) return {}
  const code = error.code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? { code }
    : {}
}
