/**
 * Provider value decoding.
 *
 * Applies a plan's decode manifest to a provider value, reversing transport-only
 * lowering before Safety and original Zod parsing. Decoding never mutates the
 * provider value: it uses copy-on-write, cloning only the ancestors of changed
 * occurrences, and returns the original reference when nothing changes. Only own
 * JSON data properties are read — getters and prototype members are ignored.
 *
 * @module
 */

import { CruxStructuredOutputDecodeError } from "./errors";
import type {
  StructuredOutputDecodeManifest,
  StructuredOutputDecodeOperation,
} from "./plan";

/** Sentinel distinguishing an absent/accessor property from a `undefined` value. */
const MISSING = Symbol("missing");

/**
 * Decode a completed provider value against a plan's decode manifest.
 *
 * @param value - The provider value to decode (never mutated).
 * @param manifest - The plan's reversible decode manifest.
 * @returns The canonical `z.input`. With an empty manifest, the exact same
 *   reference is returned.
 * @throws {CruxStructuredOutputDecodeError} When a manifest path exists but has
 *   the wrong shape to traverse.
 */
export function decodeStructuredValue<T>(
  value: T,
  manifest: StructuredOutputDecodeManifest,
): T {
  if (manifest.operations.length === 0) return value;
  let current: unknown = value;
  for (const operation of manifest.operations) {
    current = applyOperation(current, operation);
  }
  return current as T;
}

function applyOperation(
  root: unknown,
  operation: StructuredOutputDecodeOperation,
): unknown {
  return descend(root, operation.path, 0, operation.path);
}

/**
 * Walk `path` from index `i`, deleting an exactly-null leaf. Returns the same
 * reference when nothing changed, or a shallow-cloned chain when it did.
 */
function descend(
  node: unknown,
  path: readonly (string | number | "*")[],
  index: number,
  fullPath: readonly (string | number | "*")[],
): unknown {
  const segment = path[index]!;
  const isLeaf = index === path.length - 1;

  if (segment === "*") {
    if (node === null || node === undefined) return node;
    if (!Array.isArray(node)) {
      throw new CruxStructuredOutputDecodeError(
        fullPath,
        "expected an array for a wildcard segment",
      );
    }
    let changed = false;
    const next = node.map((element) => {
      const decoded = descend(element, path, index + 1, fullPath);
      if (decoded !== element) changed = true;
      return decoded;
    });
    return changed ? next : node;
  }

  if (node === null || node === undefined) return node;
  if (typeof node !== "object" || Array.isArray(node)) {
    throw new CruxStructuredOutputDecodeError(
      fullPath,
      "expected an object to traverse",
    );
  }

  const value = ownDataValue(node, segment);
  if (value === MISSING) return node;

  if (isLeaf) {
    if (value !== null) return node;
    const clone = cloneObject(node);
    delete clone[segment];
    return clone;
  }

  const decodedChild = descend(value, path, index + 1, fullPath);
  if (decodedChild === value) return node;
  const clone = cloneObject(node);
  clone[segment] = decodedChild;
  return clone;
}

/** Read an own data property, ignoring accessors and prototype members. */
function ownDataValue(
  node: object,
  key: string | number,
): unknown | typeof MISSING {
  const descriptor = Object.getOwnPropertyDescriptor(node, key);
  if (!descriptor || !("value" in descriptor)) return MISSING;
  return descriptor.value;
}

/** Shallow-clone own data properties without invoking getters. */
function cloneObject(node: object): Record<string | number, unknown> {
  const clone: Record<string | number, unknown> = {};
  for (const key of Object.keys(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (descriptor && "value" in descriptor) clone[key] = descriptor.value;
  }
  return clone;
}
