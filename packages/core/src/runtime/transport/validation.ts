import type { JsonValue } from "../../storage/types";
import type {
  RuntimeAcceptedTransportEnvelope,
  RuntimeAcceptedTransportPayload,
  RuntimeManagedTransportAdapterDeclaration,
  RuntimeManagedTransportBinding,
  RuntimeSignalTransportTarget,
  RuntimeTransportConfigRef,
} from "./contracts";
import { RuntimeManagedTransportContractError } from "./errors";

const MAX_IDENTIFIER_BYTES = 512;
const MAX_ROUTING_JSON_BYTES = 16 * 1024;
/** Caps routing traversal work before the independent encoded-size check. */
const MAX_ROUTING_DEPTH = 64;
const MAX_ROUTING_NODES = 1024;
const MAX_INLINE_PAYLOAD_BYTES = 1024 * 1024;
const MAX_INLINE_PAYLOAD_CHARACTERS = Math.ceil((MAX_INLINE_PAYLOAD_BYTES * 4) / 3);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const SECRET_ROUTING_KEY_PARTS = ["authorization", "cookie", "signature", "token"];

type PlainRecord = Record<string, unknown>;
type RoutingTraversalBudget = { depth: number; nodes: number };

/** Validates and detaches an inert provider adapter declaration. */
export function validateRuntimeManagedTransportAdapterDeclaration(
  value: unknown,
): RuntimeManagedTransportAdapterDeclaration {
  const record = requireExactRecord(value, "$", [
    "_tag",
    "id",
    "provider",
    "acceptedEnvelopeVersion",
  ]);
  return freeze({
    _tag: requireLiteral(record._tag, "RuntimeManagedTransportAdapter", "$._tag"),
    id: requireIdentifier(record.id, "$.id"),
    provider: requireIdentifier(record.provider, "$.provider"),
    acceptedEnvelopeVersion: requireLiteral(record.acceptedEnvelopeVersion, 1, "$.acceptedEnvelopeVersion"),
  });
}

/** Validates and detaches an inert binding without resolving it through a registry. */
export function validateRuntimeManagedTransportBinding(value: unknown): RuntimeManagedTransportBinding {
  const record = requireExactRecord(value, "$", ["_tag", "id", "adapter", "configRef", "target"]);
  return freeze({
    _tag: requireLiteral(record._tag, "RuntimeManagedTransportBinding", "$._tag"),
    id: requireIdentifier(record.id, "$.id"),
    adapter: validateAdapter(record.adapter, "$.adapter"),
    configRef: validateConfigRef(record.configRef, "$.configRef"),
    target: validateTarget(record.target, "$.target"),
  });
}

/**
 * Validates and detaches an accepted-envelope declaration only. It never reads a
 * request, resolves a binding, calculates a digest, or performs durable acceptance.
 */
export function validateRuntimeAcceptedTransportEnvelope(
  value: unknown,
): RuntimeAcceptedTransportEnvelope {
  const record = requireExactRecord(value, "$", [
    "_tag",
    "schemaVersion",
    "bindingId",
    "adapterId",
    "provider",
    "accountId",
    "eventId",
    "receivedAt",
    "authenticatedRouting",
    "payload",
    "configRef",
    "target",
  ]);
  const routing = validateRouting(record.authenticatedRouting, "$.authenticatedRouting");
  return freeze({
    _tag: requireLiteral(record._tag, "RuntimeAcceptedTransportEnvelope", "$._tag"),
    schemaVersion: requireLiteral(record.schemaVersion, 1, "$.schemaVersion"),
    bindingId: requireIdentifier(record.bindingId, "$.bindingId"),
    adapterId: requireIdentifier(record.adapterId, "$.adapterId"),
    provider: requireIdentifier(record.provider, "$.provider"),
    accountId: requireIdentifier(record.accountId, "$.accountId"),
    eventId: requireIdentifier(record.eventId, "$.eventId"),
    receivedAt: requireTimestamp(record.receivedAt, "$.receivedAt"),
    authenticatedRouting: routing,
    payload: validatePayload(record.payload, "$.payload"),
    configRef: validateConfigRef(record.configRef, "$.configRef"),
    target: validateTarget(record.target, "$.target"),
  });
}

function validateAdapter(value: unknown, path: string): RuntimeManagedTransportAdapterDeclaration {
  const record = requireExactRecord(value, path, ["_tag", "id", "provider", "acceptedEnvelopeVersion"]);
  return freeze({
    _tag: requireLiteral(record._tag, "RuntimeManagedTransportAdapter", `${path}._tag`),
    id: requireIdentifier(record.id, `${path}.id`),
    provider: requireIdentifier(record.provider, `${path}.provider`),
    acceptedEnvelopeVersion: requireLiteral(record.acceptedEnvelopeVersion, 1, `${path}.acceptedEnvelopeVersion`),
  });
}

function validateConfigRef(value: unknown, path: string): RuntimeTransportConfigRef {
  const record = requireExactRecord(value, path, ["id", "revision"]);
  return freeze({
    id: requireIdentifier(record.id, `${path}.id`),
    revision: requireIdentifier(record.revision, `${path}.revision`),
  });
}

function validateTarget(value: unknown, path: string): RuntimeSignalTransportTarget {
  const record = requireExactRecord(value, path, ["kind", "signalId"]);
  return freeze({
    kind: requireLiteral(record.kind, "signal", `${path}.kind`),
    signalId: requireIdentifier(record.signalId, `${path}.signalId`),
  });
}

/**
 * Validates and detaches one accepted transport payload.
 *
 * @remarks Shared by full envelope validation and managed stream item validation
 * so stream ingress cannot accept incomplete or mutable provider-owned payloads.
 */
export function validateRuntimeAcceptedTransportPayload(
  value: unknown,
  path = "$.payload",
): RuntimeAcceptedTransportPayload {
  return validatePayload(value, path);
}

/**
 * Validates and detaches authenticated routing as JSON-safe frozen data.
 *
 * @remarks Applies the same depth, node, size, cycle, and secret-key limits as
 * {@link validateRuntimeAcceptedTransportEnvelope}.
 */
export function validateRuntimeAuthenticatedRouting(
  value: unknown,
  path = "$.authenticatedRouting",
): Readonly<Record<string, JsonValue>> {
  return validateRouting(value, path);
}

function validatePayload(value: unknown, path: string): RuntimeAcceptedTransportPayload {
  const record = requireExactRecord(value, path, ["kind", "value", "byteLength", "sha256"], [
    "kind",
    "ref",
    "byteLength",
    "sha256",
  ]);
  const kind = requireString(record.kind, `${path}.kind`);
  const byteLength = requireByteLength(record.byteLength, `${path}.byteLength`);
  const sha256 = requireSha256(record.sha256, `${path}.sha256`);
  if (kind === "inline-base64url") {
    const inline = requireString(record.value, `${path}.value`);
    if (inline.length > MAX_INLINE_PAYLOAD_CHARACTERS) {
      invalid(`${path}.value`, "must not exceed encoded length for 1 MiB of decoded bytes");
    }
    if (!BASE64URL_PATTERN.test(inline) || inline.length % 4 === 1) {
      invalid(`${path}.value`, "must be unpadded base64url");
    }
    if (byteLength > MAX_INLINE_PAYLOAD_BYTES) invalid(`${path}.byteLength`, "must not exceed 1 MiB");
    if (Math.floor((inline.length * 6) / 8) !== byteLength) {
      invalid(`${path}.byteLength`, "must match decoded base64url bytes");
    }
    return freeze({ kind, value: inline, byteLength, sha256 });
  }
  if (kind === "durable-ref") {
    const ref = requireIdentifier(record.ref, `${path}.ref`);
    if (hasUrlUserinfo(ref)) invalid(`${path}.ref`, "must not include URL userinfo");
    return freeze({ kind, ref, byteLength, sha256 });
  }
  invalid(`${path}.kind`, "must be a supported payload kind");
}

function validateRouting(value: unknown, path: string): Readonly<Record<string, JsonValue>> {
  const record = requirePlainRecord(value, path);
  const routing = cloneJson(record, path, new Set(), { depth: 0, nodes: 0 }) as Readonly<Record<string, JsonValue>>;
  const encoded = JSON.stringify(routing);
  if (utf8Bytes(encoded) > MAX_ROUTING_JSON_BYTES) invalid(path, "must encode to at most 16 KiB of JSON");
  return routing;
}

function cloneJson(value: unknown, path: string, ancestors: Set<object>, budget: RoutingTraversalBudget): JsonValue {
  if (budget.depth > MAX_ROUTING_DEPTH) invalid(path, "must not exceed routing depth limit of 64");
  budget.nodes += 1;
  if (budget.nodes > MAX_ROUTING_NODES) invalid(path, "must not exceed routing node limit of 1024");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(path, "must be JSON-safe");
    return value;
  }
  if (typeof value !== "object") invalid(path, "must be detached JSON data");
  if (ancestors.has(value)) invalid(path, "must not be cyclic");
  ancestors.add(value);
  budget.depth += 1;
  const result = Array.isArray(value)
    ? cloneArray(value, path, ancestors, budget)
    : cloneRecord(value, path, ancestors, budget);
  budget.depth -= 1;
  ancestors.delete(value);
  return result;
}

function cloneRecord(value: object, path: string, ancestors: Set<object>, budget: RoutingTraversalBudget): JsonValue {
  const record = requirePlainRecord(value, path);
  const copy: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    if (hasSecretRoutingKey(key)) invalid(`${path}.${key}`, "must not contain a secret-like key");
    Object.defineProperty(copy, key, { enumerable: true, value: cloneJson(item, `${path}.${key}`, ancestors, budget) });
  }
  return freeze(copy);
}

function cloneArray(value: unknown[], path: string, ancestors: Set<object>, budget: RoutingTraversalBudget): JsonValue {
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    invalid(path, "must be a plain JSON array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (names.some((name) => name !== "length" && !/^(0|[1-9]\d*)$/.test(name))) {
    invalid(path, "must be a plain JSON array");
  }
  const copy: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
      invalid(`${path}[${index}]`, "must not contain accessors or holes");
    }
    copy.push(cloneJson(descriptor.value, `${path}[${index}]`, ancestors, budget));
  }
  return freeze(copy);
}

function requireExactRecord(value: unknown, path: string, keys: string[], alternateKeys?: string[]): PlainRecord {
  const record = requirePlainRecord(value, path);
  const actual = Object.getOwnPropertyNames(record).sort();
  const expected = keys.slice().sort();
  const alternate = alternateKeys?.slice().sort();
  if (!sameKeys(actual, expected) && (!alternate || !sameKeys(actual, alternate))) {
    invalid(path, "must contain only the required keys");
  }
  return record;
}

function requirePlainRecord(value: unknown, path: string): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be a plain record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, "must be a plain record");
  if (Object.getOwnPropertySymbols(value).length > 0) invalid(path, "must not contain symbol keys");
  const record: PlainRecord = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) invalid(`${path}.${key}`, "must not contain accessors or hidden properties");
    Object.defineProperty(record, key, { enumerable: true, value: descriptor.value });
  }
  return record;
}

function requireIdentifier(value: unknown, path: string): string {
  const identifier = requireString(value, path);
  if (!identifier || identifier.trim() !== identifier || /[\x00-\x1f\x7f]/.test(identifier)) {
    invalid(path, "must be a non-empty, trimmed identifier without ASCII controls");
  }
  if (utf8Bytes(identifier) > MAX_IDENTIFIER_BYTES) invalid(path, "must be at most 512 UTF-8 bytes");
  return identifier;
}

function requireTimestamp(value: unknown, path: string): string {
  const timestamp = requireString(value, path);
  if (!timestamp.endsWith("Z") || Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    invalid(path, "must be a canonical UTC ISO-8601 instant");
  }
  return timestamp;
}

function requireByteLength(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(path, "must be a safe non-negative integer");
  }
  return value;
}

function requireSha256(value: unknown, path: string): string {
  const sha256 = requireString(value, path);
  if (!SHA256_PATTERN.test(sha256)) invalid(path, "must be a lowercase SHA-256 hex digest");
  return sha256;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "must be a string");
  return value;
}

function requireLiteral<Value extends string | number>(value: unknown, literal: Value, path: string): Value {
  if (value !== literal) invalid(path, `must equal ${JSON.stringify(literal)}`);
  return literal;
}

function hasUrlUserinfo(ref: string): boolean {
  const match = /^(?:[A-Za-z][A-Za-z\d+.-]*:)?\/\/([^/?#]*)/.exec(ref);
  return match?.[1]?.includes("@") ?? false;
}

function hasSecretRoutingKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_ROUTING_KEY_PARTS.some((part) => normalized.includes(part));
}

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function freeze<Value>(value: Value): Value {
  return Object.freeze(value);
}

function invalid(path: string, message: string): never {
  throw new RuntimeManagedTransportContractError(path, message);
}
