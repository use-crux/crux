import { CRUX_OBSERVABILITY_SCHEMA_VERSION, type CruxGraphRecord } from './contract'
import { CruxGraphRecordSchema } from './schema'

export type EmitValidationResult =
  | {
      readonly ok: true
      readonly record: CruxGraphRecord
    }
  | {
      readonly ok: false
      readonly issues: readonly string[]
    }

/**
 * Validates a sanitized graph record without throwing into the caller.
 *
 * Development uses the full Zod contract. Production uses a cheaper structural
 * guard before the same fail-open coercion path so observability remains cheap
 * while still dropping obviously malformed records.
 */
export function validateRecordForEmission(record: unknown): EmitValidationResult {
  const parsed = validateRecord(record)
  if (parsed.ok) return parsed

  return validateRecord(coerceRecord(record))
}

function validateRecord(record: unknown): EmitValidationResult {
  if (usesProductionStructuralCheck()) {
    return structuralCheck(record)
      ? { ok: true, record: record as CruxGraphRecord }
      : {
          ok: false,
          issues: ['Record failed structural observability validation'],
        }
  }

  const parsed = CruxGraphRecordSchema.safeParse(record)
  if (parsed.success) return { ok: true, record: parsed.data as CruxGraphRecord }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
  }
}

function usesProductionStructuralCheck(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  return runtime.process?.env?.NODE_ENV === 'production'
}

function coerceRecord(record: unknown): unknown {
  if (!isRecord(record)) return record
  const coerced = { ...record }

  if (coerced.name === '') {
    coerced.name = 'unknown'
  }

  if (isRecord(coerced.metrics)) {
    coerced.metrics = coerceMetrics(coerced.metrics)
  }

  if (isRecord(coerced.error) && coerced.error.message === '') {
    coerced.error = {
      ...coerced.error,
      message: 'Error',
    }
  }

  return coerced
}

function coerceMetrics(metrics: Record<string, unknown>): Record<string, number> {
  const coerced: Record<string, number> = {}
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      coerced[key] = value
    }
  }
  return coerced
}

function structuralCheck(record: unknown): record is CruxGraphRecord {
  if (!isRecord(record)) return false
  if (record.schemaVersion !== CRUX_OBSERVABILITY_SCHEMA_VERSION) return false
  if (!requiredString(record, 'recordId')) return false
  if (!requiredString(record, 'runId')) return false
  if (record.traceId !== undefined && !requiredString(record, 'traceId')) return false

  switch (record.type) {
    case 'run:start':
      return (
        requiredString(record, 'name') && requiredString(record, 'rootPrimitive') && requiredString(record, 'startedAt')
      )
    case 'run:suspend':
      return requiredString(record, 'suspendedAt') && requiredString(record, 'reason')
    case 'run:resume':
      return (
        record.segmentSeq === 1 &&
        requiredString(record, 'resumedAt') &&
        requiredString(record, 'reason')
      )
    case 'run:end':
      return requiredString(record, 'endedAt') && requiredString(record, 'status')
    case 'span:start':
      return (
        requiredString(record, 'spanId') &&
        requiredString(record, 'family') &&
        requiredString(record, 'primitive') &&
        requiredString(record, 'name') &&
        requiredString(record, 'startedAt')
      )
    case 'span:end':
      return requiredString(record, 'spanId') && requiredString(record, 'endedAt') && requiredString(record, 'status')
    case 'span':
      return (
        requiredString(record, 'spanId') &&
        requiredString(record, 'family') &&
        requiredString(record, 'primitive') &&
        requiredString(record, 'name') &&
        requiredString(record, 'startedAt') &&
        requiredString(record, 'status')
      )
    case 'span:event':
      return requiredString(record, 'spanId') && requiredString(record, 'eventId') && requiredString(record, 'name')
    case 'edge':
      return (
        requiredString(record, 'edgeId') && requiredString(record, 'edgeType') && requiredString(record, 'createdAt')
      )
    case 'artifact':
      return (
        requiredString(record, 'artifactId') &&
        requiredString(record, 'kind') &&
        requiredString(record, 'createdAt') &&
        requiredString(record, 'contentType') &&
        requiredString(record, 'encoding')
      )
    default:
      return false
  }
}

function requiredString(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
