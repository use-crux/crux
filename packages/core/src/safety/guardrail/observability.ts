import { observe } from '../../observability'
import type { MediaGuardrailRunResult } from './types'
import type { MediaPartLocation } from '../boundary'
import { mediaLocationAttributes } from '../media/location'
import type { GuardrailBinding } from '../registry'
import type { ModelInputOrigin } from '../input-origin'
import { inputOriginAttributes } from '../input-origin-observability'
import { safetyTarget } from '../../observability/safety-presentation'

/** Record the safe observability projection for one guardrail result. */
export function recordGuardrailReport(
  binding: GuardrailBinding,
  action: string,
  phase: 'input' | 'output',
  durationMs: number,
  result: unknown,
  origin?: ModelInputOrigin,
): void {
  const guard = binding.policy
  const guardrailName = guard.id
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: guardrailReportPreview(binding.boundary.id, binding.mode, phase, action, result, origin),
    attributes: {
      guardrailName,
      category: guard.category,
      boundary: binding.boundary.id,
      mode: binding.mode,
      phase,
      action,
      ...inputOriginAttributes(origin),
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
        action,
        ...inputOriginAttributes(origin),
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
      action,
      ...inputOriginAttributes(origin),
      durationMs,
    },
  })
}

/** Record the terminal blocked edge for an enforcing guardrail result. */
export function recordGuardrailBlockedEdge(
  binding: GuardrailBinding,
  reason: string,
  origin?: ModelInputOrigin,
): void {
  recordBlockedEdge(binding, reason, origin)
}

/** Record one media result without retaining its canonical source. */
export function recordMediaGuardrailReport(
  binding: GuardrailBinding,
  result: MediaGuardrailRunResult,
  location: MediaPartLocation,
  durationMs: number,
  escalatedToBlock: boolean,
  origin?: ModelInputOrigin,
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
      target: safetyTarget(binding.boundary.id),
      mode: binding.mode,
      phase,
      action: result.action,
      ...reason,
      ...(origin ? { origin } : {}),
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
      ...inputOriginAttributes(origin),
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
        ...inputOriginAttributes(origin),
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
      ...inputOriginAttributes(origin),
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
  origin?: ModelInputOrigin,
): void {
  recordBlockedEdge(binding, reason, origin, mediaAttributes(location, escalatedToBlock))
}

function recordBlockedEdge(
  binding: GuardrailBinding,
  reason: string,
  origin?: ModelInputOrigin,
  details: Readonly<Record<string, string | number | true>> = {},
): void {
  const guardrailName = binding.policy.id
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'guardrail.report',
      target: safetyTarget(binding.boundary.id),
      mode: binding.mode,
      action: 'block',
      reason,
      ...(origin ? { origin } : {}),
      ...details,
    },
    attributes: {
      guardrailName,
      boundary: binding.boundary.id,
      mode: binding.mode,
      action: 'block',
      reason,
      ...inputOriginAttributes(origin),
      ...details,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'guardrail.blocked',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        guardrailName,
        boundary: binding.boundary.id,
        mode: binding.mode,
        reason,
        ...inputOriginAttributes(origin),
        ...details,
      },
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
  boundary: string,
  mode: 'enforce' | 'report',
  phase: 'input' | 'output',
  action: string,
  result: unknown,
  origin?: ModelInputOrigin,
): Record<string, unknown> {
  const base = {
    kind: 'guardrail.report',
    phase,
    action,
    target: safetyTarget(boundary),
    mode,
    ...(origin ? { origin } : {}),
  }
  if (!result || typeof result !== 'object') return base

  const record = result as Record<string, unknown>
  const rewrite =
    record.rewrite &&
    typeof record.rewrite === 'object' &&
    typeof (record.rewrite as { readonly kind?: unknown }).kind === 'string'
      ? {
          rewrite: { kind: (record.rewrite as { readonly kind: string }).kind },
        }
      : {}
  return {
    ...base,
    ...rewrite,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  }
}
