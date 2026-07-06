import type { SafetyCaptureSummary, SafetyDecision } from './decision'

export const POLICY_TERMINAL: unique symbol = Symbol.for('crux.safety.policyTerminal') as never

/** Marker implemented by errors that should stop generation retries. */
export interface PolicyTerminalError {
  readonly [POLICY_TERMINAL]: true
}

/** Return true when an error is terminal for policy reasons. */
export function isPolicyTerminal(error: unknown): error is Error & PolicyTerminalError {
  return (
    typeof error === 'object' &&
    error !== null &&
    POLICY_TERMINAL in error &&
    (error as { readonly [POLICY_TERMINAL]?: unknown })[POLICY_TERMINAL] === true
  )
}

/** Create a safe evidence summary for compatibility paths that still pass strings. */
export function safeCaptureSummary(content: string): SafetyCaptureSummary {
  const preview = redactPreview(content).slice(0, 500)
  return {
    level: 'safe',
    sizeBytes: new TextEncoder().encode(content).byteLength,
    hash: fnv1a64(content),
    preview,
  }
}

/** Normalize a raw string or already-safe summary into a safe capture summary. */
export function toSafetyCaptureSummary(value: string | SafetyCaptureSummary): SafetyCaptureSummary {
  return typeof value === 'string' ? safeCaptureSummary(value) : value
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, '0')
}

function redactPreview(content: string): string {
  return content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{1,}/gi, '[redacted-email]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-ssn]')
    .replace(/\b(?:sk|pk|rk|key|token)-[A-Za-z0-9_-]{3,}\b/g, '[redacted-secret]')
}

interface SafetyErrorInit {
  readonly message: string
  readonly decisions?: readonly SafetyDecision[]
}

abstract class SafetyPolicyError extends Error implements PolicyTerminalError {
  readonly [POLICY_TERMINAL] = true
  readonly decisions: readonly SafetyDecision[]

  constructor(name: string, init: SafetyErrorInit) {
    super(init.message)
    this.name = name
    this.decisions = init.decisions ?? []
  }
}

/** Configuration error such as duplicate policy ids or invalid tune fields. */
export class SafetyConfigError extends SafetyPolicyError {
  readonly duplicateId?: string
  readonly kinds?: readonly string[]
  readonly boundaries?: readonly string[]
  readonly scopes?: readonly string[]

  constructor(init: SafetyErrorInit & {
    readonly duplicateId?: string
    readonly kinds?: readonly string[]
    readonly boundaries?: readonly string[]
    readonly scopes?: readonly string[]
  }) {
    super('SafetyConfigError', init)
    this.duplicateId = init.duplicateId
    this.kinds = init.kinds
    this.boundaries = init.boundaries
    this.scopes = init.scopes
  }
}

/** Runtime error for malformed guardrail or constraint results. */
export class SafetyResultError extends SafetyPolicyError {
  readonly policyId: string
  readonly boundary: string
  readonly problem: string

  constructor(init: SafetyErrorInit & {
    readonly policyId: string
    readonly boundary: string
    readonly problem: string
  }) {
    super('SafetyResultError', init)
    this.policyId = init.policyId
    this.boundary = init.boundary
    this.problem = init.problem
  }
}

/** Structured-output text/object synchronization failure. */
export class SafetyStructuredSyncError extends SafetyPolicyError {
  readonly policyId: string
  readonly parseError: string

  constructor(init: SafetyErrorInit & { readonly policyId: string; readonly parseError: string }) {
    super('SafetyStructuredSyncError', init)
    this.policyId = init.policyId
    this.parseError = init.parseError
  }
}

/** Guard/constraint convergence failed within the bounded retry budget. */
export class SafetyConvergenceError extends SafetyPolicyError {
  readonly attempts: number

  constructor(init: SafetyErrorInit & { readonly attempts: number }) {
    super('SafetyConvergenceError', init)
    this.attempts = init.attempts
  }
}

/** Stream hold exceeded the configured bound and failed closed. */
export class StreamHoldLimitError extends SafetyPolicyError {
  readonly policyId: string
  readonly heldChars: number
  readonly heldMs: number

  constructor(init: SafetyErrorInit & {
    readonly policyId: string
    readonly heldChars: number
    readonly heldMs: number
  }) {
    super('StreamHoldLimitError', init)
    this.policyId = init.policyId
    this.heldChars = init.heldChars
    this.heldMs = init.heldMs
  }
}
