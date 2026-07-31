/**
 * Immutable internal plans for one exact provider request.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { RequestReceipt } from "../receipt/receipt";

/** One sealed exact request ready for provider dispatch. @internal */
export interface SealedRequestPlan<
  TExtra extends Record<string, unknown>,
> {
  /** Canonical request arguments reused for every transport attempt. */
  readonly request: CallArgs<TExtra>;
  /** Public evidence attached to the executed step. */
  readonly receipt: RequestReceipt;
}

/** Freeze one exact request plan without mutating canonical sources. @internal */
export function requestPlan<TExtra extends Record<string, unknown>>(
  request: CallArgs<TExtra>,
  receipt: RequestReceipt,
): SealedRequestPlan<TExtra> {
  const preserved = new Set<object>();
  if (request.schema) preserved.add(request.schema);
  const sealedRequest = immutableClone(
    request,
    preserved,
  ) as CallArgs<TExtra>;
  return Object.freeze({ request: sealedRequest, receipt });
}

function immutableClone(
  value: unknown,
  preserved: ReadonlySet<object>,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (preserved.has(value)) return value;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    value.forEach((entry, index) => {
      defineImmutableValue(clone, String(index), entry, preserved);
    });
    return Object.freeze(clone);
  }
  if (isCopyOnReadValue(value)) return copyMutableValue(value);
  if (!isPlainObject(value)) return value;

  const clone = Object.create(
    Object.getPrototypeOf(value) as object | null,
  ) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      defineImmutableValue(clone, key, descriptor.value, preserved);
      continue;
    }
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: descriptor.enumerable,
      ...(descriptor.get ? { get: descriptor.get } : {}),
    });
  }
  return Object.freeze(clone);
}

function defineImmutableValue(
  target: object,
  key: PropertyKey,
  value: unknown,
  preserved: ReadonlySet<object>,
): void {
  if (isCopyOnReadValue(value)) {
    const snapshot = copyMutableValue(value);
    Object.defineProperty(target, key, {
      configurable: false,
      enumerable: true,
      get: () => copyMutableValue(snapshot),
    });
    return;
  }
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value: immutableClone(value, preserved),
    writable: false,
  });
}

function isCopyOnReadValue(value: unknown): value is object {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof URL ||
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function copyMutableValue(value: object): object {
  if (value instanceof URL) return new URL(value.href);
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return value.slice(0, value.size, value.type);
  }
  return structuredClone(value) as object;
}
