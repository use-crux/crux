import { observe } from '../../observability'
import type { MediaGuardrailRunResult } from './types'
import type { MediaPartLocation } from '../boundary'
import { mediaLocationAttributes } from '../media/location'
import type { GuardrailBinding } from '../registry'

/** Record the safe observability projection for one guardrail result. */
export function recordGuardrailReport(
  binding: GuardrailBinding,
  action: string,
  phase: 'input' | 'output',
  durationMs: number,
  result: unknown,
): void {
  const guard = binding.policy
  const guardrailName = guard.id
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: guardrailReportPreview(phase, action, result),
    attributes: {
      guardrailName,
      category: guard.category,
      boundary: binding.boundary.id,
      mode: binding.mode,
      phase,
      action,
      durationMs,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { guardrailName, boundary: binding.boundary.id, mode: binding.mode, action },
    })
  }
  observe.event({
    name: 'guardrail.action',
    attributes: { guardrailName, boundary: binding.boundary.id, mode: binding.mode, phase, action, durationMs },
  })
}

/** Record the terminal blocked edge for an enforcing guardrail result. */
export function recordGuardrailBlockedEdge(binding: GuardrailBinding, reason: string): void {
  recordBlockedEdge(binding, reason)
}

/** Record one media result without retaining its canonical source. */
export function recordMediaGuardrailReport(
  binding: GuardrailBinding,
  result: MediaGuardrailRunResult,
  location: MediaPartLocation,
  durationMs: number,
  escalatedToBlock: boolean,
): void {
  const guardrailName = binding.policy.id
  const media = mediaAttributes(location, escalatedToBlock)
  const phase = binding.boundary.id === 'model.output.media' ? 'output' : 'input'
  const reason = result.action === 'allow' ? {} : { reason: result.reason }
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'guardrail.report',
      phase,
      action: result.action,
      ...reason,
      ...media,
    },
    attributes: {
      guardrailName,
      category: binding.policy.category,
      boundary: binding.boundary.id,
      mode: binding.mode,
      phase,
      action: result.action,
      ...reason,
      ...media,
      durationMs,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        guardrailName,
        boundary: binding.boundary.id,
        mode: binding.mode,
        action: result.action,
        ...media,
      },
    })
  }
  observe.event({
    name: 'guardrail.action',
    attributes: {
      guardrailName,
      boundary: binding.boundary.id,
      mode: binding.mode,
      phase,
      action: result.action,
      ...reason,
      ...media,
      durationMs,
    },
  })
}

/** Record a media block edge with only safe original-coordinate metadata. */
export function recordMediaGuardrailBlockedEdge(
  binding: GuardrailBinding,
  reason: string,
  location: MediaPartLocation,
  escalatedToBlock: boolean,
): void {
  recordBlockedEdge(binding, reason, mediaAttributes(location, escalatedToBlock))
}

function recordBlockedEdge(
  binding: GuardrailBinding,
  reason: string,
  details: Readonly<Record<string, string | number | true>> = {},
): void {
  const guardrailName = binding.policy.id
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: { kind: 'guardrail.report', action: 'block', reason, ...details },
    attributes: {
      guardrailName,
      boundary: binding.boundary.id,
      mode: binding.mode,
      action: 'block',
      reason,
      ...details,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'guardrail.blocked',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { guardrailName, boundary: binding.boundary.id, mode: binding.mode, reason, ...details },
    })
  }
}

function mediaAttributes(
  location: MediaPartLocation,
  escalatedToBlock: boolean,
): Readonly<Record<string, string | number | true>> {
  return {
    ...mediaLocationAttributes(location),
    ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
  }
}

function guardrailReportPreview(
  phase: 'input' | 'output',
  action: string,
  result: unknown,
): Record<string, unknown> {
  const base = {
    kind: 'guardrail.report',
    phase,
    action,
  }
  if (!result || typeof result !== 'object') return base

  const record = result as Record<string, unknown>
  return {
    ...base,
    ...record,
    ...(typeof record.value === 'string' ? { afterPreview: record.value.slice(0, 500) } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  }
}
