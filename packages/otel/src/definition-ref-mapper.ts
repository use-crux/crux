/** Privacy-bounded OTel projection for canonical Crux DefinitionRefs. */

import {
  DefinitionRefSchema,
  sanitizeDefinitionSource,
} from '@use-crux/core/observability'
import type { OtelAttributes } from './attribute-mapper'
import type { SpanManager, SpanRef } from './span-manager'

const MAX_DEFINITION_REF_EVENTS = 16
const MAX_DEFINITION_REF_TEXT_BYTES = 8 * 1_024
const textEncoder = new TextEncoder()

interface DefinitionRefEvent {
  readonly attributes: OtelAttributes
}

export interface DefinitionRefProjection {
  readonly attributes: OtelAttributes
  readonly events: readonly DefinitionRefEvent[]
}

/**
 * Validate and bound DefinitionRefs without letting unexpected input escape
 * into telemetry or throw through application work.
 */
export function definitionRefProjection(
  value: unknown,
): DefinitionRefProjection {
  if (!Array.isArray(value) || value.length === 0) {
    return { attributes: {}, events: [] }
  }

  let remainingTextBytes = MAX_DEFINITION_REF_TEXT_BYTES
  let primaryChosen = false
  let truncated = false
  let attributes: OtelAttributes = {}
  const events: DefinitionRefEvent[] = []

  for (const candidate of value) {
    const parsed = DefinitionRefSchema.safeParse(candidate)
    if (!parsed.success) {
      truncated = true
      continue
    }

    if (!primaryChosen) {
      primaryChosen = true
      const primary = primaryAttributes(parsed.data)
      const primaryBytes = attributeTextBytes(primary)
      if (primaryBytes > remainingTextBytes) {
        truncated = true
        break
      }
      attributes = primary
      remainingTextBytes -= primaryBytes
    }

    if (events.length >= MAX_DEFINITION_REF_EVENTS) {
      truncated = true
      break
    }
    const event = eventAttributes(parsed.data)
    const eventBytes = attributeTextBytes(event)
    if (eventBytes > remainingTextBytes) {
      truncated = true
      break
    }
    events.push({ attributes: event })
    remainingTextBytes -= eventBytes
  }

  if (events.length < value.length) truncated = true
  if (truncated) {
    attributes = {
      ...attributes,
      'crux.definition.refs_truncated': true,
      'crux.definition.refs_total': value.length,
    }
  }
  return { attributes, events }
}

/** Emit already-bounded DefinitionRef events on a newly started span. */
export function addDefinitionRefEvents(
  spanManager: SpanManager,
  ref: SpanRef,
  projection: DefinitionRefProjection,
): void {
  for (const event of projection.events) {
    spanManager.addEvent(ref, 'crux.definition.ref', event.attributes)
  }
}

function primaryAttributes(
  ref: ReturnType<typeof DefinitionRefSchema.parse>,
): OtelAttributes {
  return {
    'crux.definition.id': ref.id,
    'crux.definition.kind': ref.kind,
    'crux.definition.role': ref.role,
  }
}

function eventAttributes(
  ref: ReturnType<typeof DefinitionRefSchema.parse>,
): OtelAttributes {
  const source = sanitizeDefinitionSource(ref.source)
  return {
    ...primaryAttributes(ref),
    ...(source
      ? {
          'crux.definition.source.file': source.file,
          'crux.definition.source.line': source.line,
          ...(source.column !== undefined
            ? { 'crux.definition.source.column': source.column }
            : {}),
        }
      : {}),
  }
}

function attributeTextBytes(attributes: OtelAttributes): number {
  let total = 0
  for (const value of Object.values(attributes)) {
    if (typeof value === 'string') total += textEncoder.encode(value).byteLength
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') total += textEncoder.encode(item).byteLength
      }
    }
  }
  return total
}
