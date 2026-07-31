/**
 * Payload-safe observability for canonical Thread operations.
 *
 * Operations retain structural identities, roles, counts, state transitions,
 * and publication decisions. Message content never enters attributes, so the
 * records remain safe even when no input/output capture is enabled.
 *
 * @module
 */

import {
  observe,
  threadDefinitionRef,
  type CruxAttributes,
} from "../observability";

export type ThreadOperation =
  | "append"
  | "read"
  | "edit"
  | "select"
  | "redact"
  | "delete"
  | "history.override";

interface ObserveThreadOperationOptions<TResult> {
  readonly threadId: string;
  readonly operation: ThreadOperation;
  readonly attributes?: CruxAttributes;
  readonly run: () => Promise<TResult>;
  readonly complete?: (result: TResult) => CruxAttributes;
}

/** Run one Thread operation inside the canonical observability graph. */
export async function observeThreadOperation<TResult>(
  options: ObserveThreadOperationOptions<TResult>,
): Promise<TResult> {
  const start = {
    threadId: options.threadId,
    operation: options.operation,
    ...options.attributes,
  };
  const name = `thread.${options.operation}`;
  const span = observe.openSpan({
    name,
    primitive: "thread.operation",
    attributes: start,
    definitionRefs: [threadDefinitionRef(options.threadId)],
  });
  try {
    const result = await span.withContext(options.run);
    const attributes = {
      ...start,
      ...options.complete?.(result),
    };
    span.withContext(() => {
      observe.event({ name, attributes });
    });
    span.end({ attributes });
    return result;
  } catch (error) {
    span.error(error, {
      ...start,
      ...threadErrorAttributes(error),
    });
    throw error;
  }
}

/** Record that explicit call-site messages shadowed managed Thread I/O. */
export function emitThreadHistoryOverrideEvidence(
  threadId: string,
  reason: string,
): void {
  const name = "thread.history.override";
  const attributes = {
    threadId,
    operation: "history.override" as const,
    state: "shadowed" as const,
    reason,
  };
  const span = observe.openSpan({
    name,
    primitive: "thread.operation",
    attributes,
    definitionRefs: [threadDefinitionRef(threadId)],
  });
  span.withContext(() => {
    observe.event({ name, attributes });
  });
  span.end({ attributes });
}

function threadErrorAttributes(error: unknown): CruxAttributes {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return { errorCode: error.code };
  }
  return {};
}
