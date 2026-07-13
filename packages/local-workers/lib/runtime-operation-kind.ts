import type { RuntimeOperationKind } from "@use-crux/indexer/host";

const RUNTIME_OPERATION_KINDS = new Set<RuntimeOperationKind>([
  "setup-check",
  "setup-apply",
  "preflight",
  "status",
  "inspect",
  "retry",
  "cancel",
]);

/** Return whether a worker request names a supported Runtime operation. */
export function isRuntimeOperationKind(
  value: string,
): value is RuntimeOperationKind {
  return RUNTIME_OPERATION_KINDS.has(value as RuntimeOperationKind);
}
