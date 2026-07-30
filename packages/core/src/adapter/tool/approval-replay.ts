/**
 * Stateless commitment and validation for durable tool approvals.
 *
 * Core treats materializer-owned tool identity as opaque canonical JSON. The
 * approval token is the HMAC key, binding the durable request to the exact
 * call, input, tool contract, and requesting policies a human approved.
 *
 * @internal
 * @module
 */

import { sha256Hex } from '../../content/sha256'
import type { JsonValue } from '../../types/tool'
import type {
  ToolApprovalPolicyIdentity,
  ToolApprovalReplayProvenance,
} from '../../tools/types'

type CommittedToolApprovalReplayProvenance = Extract<
  ToolApprovalReplayProvenance,
  { readonly version: 2 }
>

const V1_DOMAIN = 'crux.tool-approval-replay:v1\0'
const V2_DOMAIN = 'crux.tool-approval-replay:v2\0'
const encoder = new TextEncoder()

interface ApprovalReplayFields {
  readonly approvalId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly input: JsonValue
}

/** Lifecycle facts authenticated by a V2 approval continuation. */
export type CommittedApprovalReplayLifecycle = Pick<
  CommittedToolApprovalReplayProvenance,
  | 'identityEpoch'
  | 'namespace'
  | 'attempt'
  | 'requestProducer'
  | 'requestArtifactId'
  | 'requestEvidence'
>

/** Create the v1 replay provenance committed into an approval request. */
export function createApprovalReplayProvenance(
  fields: ApprovalReplayFields,
  approvalToken: string,
  tool: JsonValue,
  policies: readonly ToolApprovalPolicyIdentity[],
): ToolApprovalReplayProvenance {
  const sortedPolicies = canonicalPolicyIdentities(policies)
  return {
    version: 1,
    tool,
    policies: sortedPolicies,
    commitment: approvalReplayCommitmentV1(fields, approvalToken, tool, sortedPolicies),
  }
}

/** Create a strictly validated V2 continuation with exact authority provenance. */
export function createCommittedApprovalReplayProvenance(
  fields: ApprovalReplayFields,
  approvalToken: string,
  tool: JsonValue,
  policies: readonly ToolApprovalPolicyIdentity[],
  lifecycle: CommittedApprovalReplayLifecycle,
): CommittedToolApprovalReplayProvenance {
  assertApprovalReplayLifecycle(lifecycle)
  const sortedPolicies = canonicalPolicyIdentities(policies)
  const replay = {
    version: 2,
    ...lifecycle,
    tool,
    policies: sortedPolicies,
  } as const
  return {
    ...replay,
    commitment: approvalReplayCommitmentV2(fields, approvalToken, replay),
  }
}

/** Verify the durable request before consulting any rediscovered state. */
export function verifyApprovalReplayCommitment(
  fields: ApprovalReplayFields,
  approvalToken: string,
  replay: ToolApprovalReplayProvenance,
): boolean {
  if (replay.version === 2) {
    if (!validApprovalReplayLifecycle(replay)) return false
    const expected = approvalReplayCommitmentV2(fields, approvalToken, replay)
    return constantTimeEqual(expected, replay.commitment)
  }
  const expected = approvalReplayCommitmentV1(fields, approvalToken, replay.tool, replay.policies)
  return constantTimeEqual(expected, replay.commitment)
}

/** Compare a verified request with the rediscovered tool and policies. */
export function matchesApprovalReplayIdentity(
  replay: ToolApprovalReplayProvenance,
  currentTool: JsonValue | undefined,
  currentPolicies: readonly ToolApprovalPolicyIdentity[],
): boolean {
  if (currentTool === undefined) return false
  return (
    canonicalJson(currentTool) === canonicalJson(replay.tool) &&
    canonicalJson(canonicalPolicyIdentities(currentPolicies)) === canonicalJson(replay.policies)
  )
}

/** Deduplicate and canonically sort requesting policy identities. */
export function canonicalPolicyIdentities(
  policies: readonly ToolApprovalPolicyIdentity[],
): readonly ToolApprovalPolicyIdentity[] {
  const byCanonicalJson = new Map(policies.map((policy) => [canonicalJson(policy), policy] as const))
  return [...byCanonicalJson.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, policy]) => policy)
}

function approvalReplayCommitmentV1(
  fields: ApprovalReplayFields,
  approvalToken: string,
  tool: JsonValue,
  policies: readonly ToolApprovalPolicyIdentity[],
): string {
  const data = `${V1_DOMAIN}${canonicalJson({ ...fields, tool, policies })}`
  return hmacSha256(approvalToken, data)
}

function approvalReplayCommitmentV2(
  fields: ApprovalReplayFields,
  approvalToken: string,
  replay: Omit<CommittedToolApprovalReplayProvenance, 'commitment'>,
): string {
  const data = `${V2_DOMAIN}${canonicalJson({
    ...fields,
    version: replay.version,
    identityEpoch: replay.identityEpoch,
    namespace: replay.namespace,
    attempt: replay.attempt,
    requestProducer: replay.requestProducer,
    requestArtifactId: replay.requestArtifactId,
    requestEvidence: replay.requestEvidence,
    tool: replay.tool,
    policies: replay.policies,
  })}`
  return hmacSha256(approvalToken, data)
}

function assertApprovalReplayLifecycle(
  lifecycle: CommittedApprovalReplayLifecycle,
): void {
  if (!validApprovalReplayLifecycle({ version: 2, ...lifecycle })) {
    throw new TypeError(
      'Tool approval request evidence must target its exact committed attempt.',
    )
  }
}

function validApprovalReplayLifecycle(value: unknown): boolean {
  if (!isRecord(value)) return false
  const namespace = value.namespace
  const attempt = value.attempt
  const requestProducer = value.requestProducer
  const evidence = value.requestEvidence
  if (
    !isRecord(namespace) ||
    !isRecord(attempt) ||
    !isRecord(requestProducer) ||
    !isRecord(evidence)
  ) {
    return false
  }
  const subject = evidence.subject
  if (!isRecord(subject)) return false
  return (
    value.identityEpoch === 1 &&
    validRunId(namespace.operationId) &&
    validRunId(namespace.runId) &&
    validExecutionRef(attempt) &&
    validExecutionRef(requestProducer) &&
    attempt.runId === namespace.runId &&
    typeof value.requestArtifactId === 'string' &&
    /^artifact_[0-9a-f]{64}$/u.test(value.requestArtifactId) &&
    evidence.kind === 'execution.evidence' &&
    typeof evidence.id === 'string' &&
    /^evidence_[0-9a-f]{16,64}$/u.test(evidence.id) &&
    subject.kind === 'execution' &&
    subject.id === attempt.spanId &&
    evidence.role === 'authority' &&
    evidence.evidenceKind === 'approval.request' &&
    typeof evidence.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(evidence.recordedAt))
  )
}

function validExecutionRef(value: Readonly<Record<string, unknown>>): boolean {
  return (
    validRunId(value.runId) &&
    typeof value.traceId === 'string' &&
    /^[0-9a-f]{32}$/u.test(value.traceId) &&
    !/^0+$/u.test(value.traceId) &&
    typeof value.spanId === 'string' &&
    /^[0-9a-f]{16}$/u.test(value.spanId) &&
    !/^0+$/u.test(value.spanId)
  )
}

function validRunId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hmacSha256(key: string, data: string): string {
  const blockSize = 64
  const encodedKey = encoder.encode(key)
  const keyBlock = new Uint8Array(blockSize)
  keyBlock.set(encodedKey.length > blockSize ? hexBytes(sha256Hex(encodedKey)) : encodedKey)
  const innerPad = keyBlock.map((byte) => byte ^ 0x36)
  const outerPad = keyBlock.map((byte) => byte ^ 0x5c)
  const inner = hexBytes(sha256Hex(concat(innerPad, encoder.encode(data))))
  return sha256Hex(concat(outerPad, inner))
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(',')}}`
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(left.length + right.length)
  bytes.set(left)
  bytes.set(right, left.length)
  return bytes
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  )
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}
