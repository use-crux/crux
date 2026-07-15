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
import type { ToolApprovalPolicyIdentity, ToolApprovalReplayProvenance } from '../../tools/types'

const DOMAIN = 'crux.tool-approval-replay:v1\0'
const encoder = new TextEncoder()

interface ApprovalReplayFields {
  readonly approvalId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly input: JsonValue
}

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
    commitment: approvalReplayCommitment(fields, approvalToken, tool, sortedPolicies),
  }
}

/** Verify the durable request before consulting any rediscovered state. */
export function verifyApprovalReplayCommitment(
  fields: ApprovalReplayFields,
  approvalToken: string,
  replay: ToolApprovalReplayProvenance,
): boolean {
  if (replay.version !== 1) return false
  const expected = approvalReplayCommitment(fields, approvalToken, replay.tool, replay.policies)
  return constantTimeEqual(expected, replay.commitment)
}

/** Compare a verified request with the rediscovered tool and policies. */
export function matchesApprovalReplayIdentity(
  replay: ToolApprovalReplayProvenance,
  currentTool: JsonValue | undefined,
  currentPolicies: readonly ToolApprovalPolicyIdentity[],
): boolean {
  if (replay.version !== 1 || currentTool === undefined) return false
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

function approvalReplayCommitment(
  fields: ApprovalReplayFields,
  approvalToken: string,
  tool: JsonValue,
  policies: readonly ToolApprovalPolicyIdentity[],
): string {
  const data = `${DOMAIN}${canonicalJson({ ...fields, tool, policies })}`
  return hmacSha256(approvalToken, data)
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

function canonicalJson(value: JsonValue | readonly ToolApprovalPolicyIdentity[]): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item as JsonValue)).join(',')}]`
  const record = value as Readonly<Record<string, JsonValue | undefined>>
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
