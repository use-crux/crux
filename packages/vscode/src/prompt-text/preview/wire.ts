import type {
  PromptTextPreviewChooseResult,
  PromptTextPreviewReadyResult,
  PromptTextPreviewSelection,
  PromptTextPreviewSource,
  PromptTextPreviewStaticResult,
  PromptTextPreviewUnavailableResult,
} from './types.js'
import {
  compareRange,
  hasExactKeys,
  isContentStatus,
  isEvidence,
  isRecord,
  isServerUnavailableReason,
  isStructuralStatus,
  parseSelection,
  parseStamp,
  parseTruncation,
} from './validation.js'

/**
 * Validate and detach one untrusted static-preview response.
 *
 * The private ABI is closed recursively. Invalid results are returned as
 * `undefined` so the lifecycle controller can clear bytes without interpreting
 * a partial or future protocol shape.
 */
export function parsePromptTextPreviewStaticResult(
  value: unknown,
): PromptTextPreviewStaticResult | undefined {
  if (!isRecord(value)) return undefined
  switch (value.kind) {
    case 'ready':
      return parseReady(value)
    case 'choose':
      return parseChoose(value)
    case 'unavailable':
      return parseUnavailable(value)
    default:
      return undefined
  }
}

/** Compare the complete buffer identity echoed by private PromptText pulls. */
export function samePromptTextPreviewStamp(
  left: Pick<
    PromptTextPreviewSource,
    'uri' | 'openEpoch' | 'version' | 'sourceHash'
  >,
  right: Pick<
    PromptTextPreviewSource,
    'uri' | 'openEpoch' | 'version' | 'sourceHash'
  >,
): boolean {
  return (
    left.uri === right.uri &&
    left.openEpoch === right.openEpoch &&
    left.version === right.version &&
    left.sourceHash === right.sourceHash
  )
}

function parseReady(
  value: Readonly<Record<string, unknown>>,
): PromptTextPreviewReadyResult | undefined {
  if (
    !hasExactKeys(
      value,
      [
        'protocolVersion',
        'uri',
        'openEpoch',
        'version',
        'sourceHash',
        'kind',
        'selection',
        'requestStatus',
        'templateStatus',
        'previewStatus',
        'evidence',
        'text',
      ],
      ['truncation'],
    )
  )
    return undefined

  const stamp = parseStamp(value)
  const selection = parseSelection(value.selection)
  if (
    stamp === undefined ||
    selection === undefined ||
    !isStructuralStatus(value.requestStatus) ||
    !isStructuralStatus(value.templateStatus) ||
    !isContentStatus(value.previewStatus) ||
    !isEvidence(value.evidence) ||
    typeof value.text !== 'string'
  )
    return undefined

  const truncation =
    value.truncation === undefined
      ? undefined
      : parseTruncation(value.truncation)
  if (
    (value.previewStatus === 'complete' && truncation !== undefined) ||
    (value.previewStatus === 'truncated' && truncation === undefined)
  ) {
    return undefined
  }
  const result: PromptTextPreviewReadyResult = {
    ...stamp,
    kind: 'ready',
    selection,
    requestStatus: value.requestStatus,
    templateStatus: value.templateStatus,
    previewStatus: value.previewStatus,
    evidence: value.evidence,
    text: value.text,
  }
  return truncation === undefined ? result : { ...result, truncation }
}

function parseChoose(
  value: Readonly<Record<string, unknown>>,
): PromptTextPreviewChooseResult | undefined {
  if (
    !hasExactKeys(value, [
      'protocolVersion',
      'uri',
      'openEpoch',
      'version',
      'sourceHash',
      'kind',
      'requestStatus',
      'choices',
    ])
  )
    return undefined
  const stamp = parseStamp(value)
  if (
    stamp === undefined ||
    !isStructuralStatus(value.requestStatus) ||
    !Array.isArray(value.choices) ||
    value.choices.length === 0
  )
    return undefined
  const choices: PromptTextPreviewSelection[] = []
  for (const candidate of value.choices) {
    const choice = parseSelection(candidate)
    const previous = choices.at(-1)
    if (
      choice === undefined ||
      (previous !== undefined &&
        (choice.ordinal <= previous.ordinal ||
          compareRange(choice.range, previous.range) <= 0))
    ) {
      return undefined
    }
    choices.push(choice)
  }
  return {
    ...stamp,
    kind: 'choose',
    requestStatus: value.requestStatus,
    choices,
  }
}

function parseUnavailable(
  value: Readonly<Record<string, unknown>>,
): PromptTextPreviewUnavailableResult | undefined {
  if (
    !hasExactKeys(value, [
      'protocolVersion',
      'uri',
      'openEpoch',
      'version',
      'sourceHash',
      'kind',
      'reason',
    ])
  )
    return undefined
  const stamp = parseStamp(value)
  if (stamp === undefined || !isServerUnavailableReason(value.reason)) {
    return undefined
  }
  return { ...stamp, kind: 'unavailable', reason: value.reason }
}
