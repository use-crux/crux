import type { MediaGuardrailRunResult } from '../../types'
import type { MediaPolicyFacts, MediaPolicyViolation, NormalizedMediaGuardrailConfig } from './types'

export function evaluateMediaPolicy(
  config: NormalizedMediaGuardrailConfig,
  facts: MediaPolicyFacts,
): MediaGuardrailRunResult {
  const violations = [
    ...evaluateMediaType(config, facts),
    ...evaluateMediaSize(config, facts),
    ...evaluateMediaSource(config, facts),
  ]
  if (violations.length === 0) return { action: 'allow' }
  return {
    action: config.action,
    reason: formatMediaPolicyViolations(violations),
  }
}

function evaluateMediaSource(
  config: NormalizedMediaGuardrailConfig,
  facts: MediaPolicyFacts,
): readonly MediaPolicyViolation[] {
  const rule = config.sources
  if (rule === undefined) return []
  switch (facts.source.kind) {
    case 'inline':
      return rule.allowInline ? [] : [{ kind: 'media-inline-not-allowed' }]
    case 'provider-file':
      return rule.allowProviderFiles ? [] : [{ kind: 'media-provider-file-not-allowed' }]
    case 'unknown':
      return [{ kind: 'media-source-unknown' }]
    case 'url': {
      const violations: MediaPolicyViolation[] = []
      if (rule.allowHosts !== undefined && !rule.allowHosts.includes(facts.source.hostname)) {
        violations.push({ kind: 'media-host-not-allowed' })
      }
      if (!rule.allowUrlUserInfo && facts.source.hasUserInfo) {
        violations.push({ kind: 'media-url-userinfo-not-allowed' })
      }
      if (!rule.allowUrlQuery && facts.source.hasQuery) {
        violations.push({ kind: 'media-url-query-not-allowed' })
      }
      return violations
    }
  }
}

function evaluateMediaSize(
  config: NormalizedMediaGuardrailConfig,
  facts: MediaPolicyFacts,
): readonly MediaPolicyViolation[] {
  if (config.size === undefined) return []
  if (facts.sizeBytes === undefined) {
    return config.size.allowUnknown ? [] : [{ kind: 'media-size-unknown' }]
  }
  return facts.sizeBytes > config.size.maxBytes
    ? [{
        kind: 'media-size-exceeded',
        sizeBytes: facts.sizeBytes,
        maxBytes: config.size.maxBytes,
      }]
    : []
}

function evaluateMediaType(
  config: NormalizedMediaGuardrailConfig,
  facts: MediaPolicyFacts,
): readonly MediaPolicyViolation[] {
  if (config.mediaTypes === undefined) return []
  if (facts.mediaType === undefined) {
    return config.mediaTypes.allowUnknown ? [] : [{ kind: 'media-type-unknown' }]
  }
  return config.mediaTypes.allow.some((pattern) => matchesMediaType(pattern, facts.mediaType!))
    ? []
    : [{ kind: 'media-type-not-allowed', mediaType: facts.mediaType }]
}

function matchesMediaType(pattern: string, mediaType: string): boolean {
  return pattern.endsWith('/*') ? mediaType.startsWith(pattern.slice(0, -1)) : pattern === mediaType
}

function formatMediaPolicyViolations(violations: readonly MediaPolicyViolation[]): string {
  const reasons = violations.map((violation) => {
    switch (violation.kind) {
      case 'media-type-unknown':
        return 'media type is unknown'
      case 'media-type-not-allowed':
        return `media type "${violation.mediaType}" is not allowed`
      case 'media-size-unknown':
        return 'media size is unknown'
      case 'media-size-exceeded':
        return `media size ${violation.sizeBytes} bytes exceeds the ${violation.maxBytes} byte limit`
      case 'media-inline-not-allowed':
        return 'inline media sources are not allowed'
      case 'media-provider-file-not-allowed':
        return 'provider-file media sources are not allowed'
      case 'media-host-not-allowed':
        return 'media source host is not allowed'
      case 'media-url-userinfo-not-allowed':
        return 'media source URL userinfo is not allowed'
      case 'media-url-query-not-allowed':
        return 'media source URL query strings are not allowed'
      case 'media-source-unknown':
        return 'media source is unknown'
    }
  })
  return `Media attachment violates policy: ${reasons.join('; ')}.`
}
