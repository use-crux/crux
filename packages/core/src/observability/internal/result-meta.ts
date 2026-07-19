import type {
  OperationResultMeta,
  WithOperationResultMeta,
} from "../result-meta";

const RESULT_BOUNDARY = "Crux operation result boundary";

function assertEnvelope(result: unknown): asserts result is object {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new TypeError(`${RESULT_BOUNDARY} requires an object envelope.`);
  }
}

function assertMetadata(metadata: unknown): asserts metadata is object {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    throw new TypeError(`${RESULT_BOUNDARY} requires object _meta when present.`);
  }
}

function createMetadata(
  existing: object,
  operation: OperationResultMeta,
): Readonly<object & OperationResultMeta> {
  const descriptors = Object.getOwnPropertyDescriptors(existing);
  delete descriptors.traceId;
  delete descriptors.spanId;

  const metadata = Object.create(Object.getPrototypeOf(existing)) as object;
  Object.defineProperties(metadata, descriptors);
  Object.defineProperties(metadata, {
    traceId: { enumerable: true, value: operation.traceId },
    spanId: { enumerable: true, value: operation.spanId },
  });
  return Object.freeze(metadata) as Readonly<object & OperationResultMeta>;
}

/** Finalize a known Crux result envelope with its producing operation identity. */
export function withOperationResultMeta<TResult extends object>(
  result: TResult,
  operation: OperationResultMeta,
): WithOperationResultMeta<TResult> {
  assertEnvelope(result);

  const existingMetadata = Reflect.get(result, "_meta") as unknown;
  if (existingMetadata !== undefined) assertMetadata(existingMetadata);

  if (
    existingMetadata !== undefined &&
    Reflect.get(existingMetadata, "traceId") === operation.traceId &&
    Reflect.get(existingMetadata, "spanId") === operation.spanId
  ) {
    return result as TResult & WithOperationResultMeta<TResult>;
  }

  const descriptors = Object.getOwnPropertyDescriptors(result);
  delete descriptors._meta;

  const finalized = Object.create(Object.getPrototypeOf(result)) as object;
  Object.defineProperties(finalized, descriptors);
  Object.defineProperty(finalized, "_meta", {
    enumerable: true,
    value: createMetadata(existingMetadata ?? {}, operation),
  });
  if (!Object.isExtensible(result)) Object.preventExtensions(finalized);

  return finalized as WithOperationResultMeta<TResult>;
}
