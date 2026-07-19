/** Legacy SDK stream-completion metadata compatibility. @internal */

import type { ExecutorStreamMeta } from "../executor-types";
import type { OperationResultMeta } from "../../observability";

/**
 * Expose a Promise-compatible legacy slot without starting completion work.
 *
 * The modern `completion()` method remains the execution trigger. Legacy
 * readers start the same memoized work when they await, chain, or finalize the
 * compatibility promise.
 */
export function lazyCompletionPromise<TResult>(
  completion: () => Promise<TResult>,
): Promise<TResult> {
  const lazy = {
    then: <TResult1 = TResult, TResult2 = never>(
      onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => completion().then(onfulfilled, onrejected),
    catch: <TResult2 = never>(
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => completion().catch(onrejected),
    finally: (onfinally?: (() => void) | null) => completion().finally(onfinally),
    [Symbol.toStringTag]: "Promise",
  };
  return lazy as Promise<TResult>;
}

/** Add the legacy promise as a non-enumerable compatibility capability. */
export function operationMetaWithLegacyCompletion(
  operation: OperationResultMeta,
  completion: Promise<ExecutorStreamMeta | undefined>,
): OperationResultMeta {
  const metadata = {
    traceId: operation.traceId,
    spanId: operation.spanId,
  };
  Object.defineProperty(metadata, "_streamCompletion", {
    enumerable: false,
    value: completion,
  });
  return Object.freeze(metadata);
}

/**
 * Point an existing legacy raw completion slot at the observed completion.
 *
 * Provider codecs may create `_meta._streamCompletion` before core owns an
 * operation identity. The public execution boundary replaces only that
 * existing slot; it does not add metadata to provider streams that never
 * advertised the compatibility field.
 */
export function replaceLegacyStreamCompletion(
  raw: unknown,
  completion: Promise<ExecutorStreamMeta | undefined>,
): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as { _meta?: unknown };
  const metadata = Reflect.get(record, "_meta");
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("_streamCompletion" in metadata)
  ) {
    return false;
  }
  tryReplaceMetadata(record, metadata, completion);
  return true;
}

function tryReplaceMetadata(
  raw: object,
  metadata: object,
  completion: Promise<ExecutorStreamMeta | undefined>,
): void {
  try {
    const replacement = cloneMetadata(metadata, completion);
    const descriptor = Object.getOwnPropertyDescriptor(raw, "_meta");
    if (descriptor && "value" in descriptor) {
      Object.defineProperty(raw, "_meta", { ...descriptor, value: replacement });
      return;
    }
    if (descriptor?.set) {
      descriptor.set.call(raw, replacement);
      return;
    }
    if (!descriptor && Object.isExtensible(raw)) {
      Object.defineProperty(raw, "_meta", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: replacement,
      });
    }
  } catch {
    // Legacy metadata is best effort; immutable provider raw objects stay raw.
  }
}

function cloneMetadata(
  metadata: object,
  completion: Promise<ExecutorStreamMeta | undefined>,
): object {
  const clone = Object.create(Object.getPrototypeOf(metadata)) as object;
  for (const key of Reflect.ownKeys(metadata)) {
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
    if (!descriptor) continue;
    Object.defineProperty(
      clone,
      key,
      key === "_streamCompletion"
        ? {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            writable: "writable" in descriptor ? descriptor.writable : false,
            value: completion,
          }
        : descriptor,
    );
  }
  if (!Object.isExtensible(metadata)) Object.preventExtensions(clone);
  return clone;
}
