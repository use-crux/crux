/** Public graph evidence for non-executing capture-policy registrations. */

import {
  observe,
  type CapturedObservabilityContext,
} from "../../observability";
import type { ScopeDescriptor } from "../../scope/types";

export function emitInlineCapturedEvidence(input: {
  readonly context: CapturedObservabilityContext;
  readonly sequence: number;
  readonly scope: ScopeDescriptor;
}): void {
  observe.withContext(input.context, () => {
    const span = observe.openSpan({
      name: `defer inline captured #${input.sequence}`,
      primitive: "defer.scheduled",
      attributes: {
        mode: "inline-captured",
        sequence: input.sequence,
        ...scopeAttributes(input.scope),
      },
    });
    span.end({
      status: "ok",
      attributes: { mode: "inline-captured", sequence: input.sequence },
    });
  });
}

export function emitNamedCapturedEvidence(input: {
  readonly context: CapturedObservabilityContext;
  readonly sequence: number;
  readonly targetId: string;
  readonly workId: string;
  readonly acceptedInput: unknown;
  readonly scope: ScopeDescriptor;
}): void {
  observe.withContext(input.context, () => {
    const span = observe.openSpan({
      name: `defer named captured ${input.targetId}`,
      primitive: "defer.scheduled",
      attributes: {
        mode: "named-captured",
        sequence: input.sequence,
        targetId: input.targetId,
        workId: input.workId,
        input: input.acceptedInput,
        ...scopeAttributes(input.scope),
      },
    });
    span.end({
      status: "ok",
      attributes: {
        mode: "named-captured",
        sequence: input.sequence,
        targetId: input.targetId,
        workId: input.workId,
      },
    });
  });
}

function scopeAttributes(
  scope: ScopeDescriptor,
): Readonly<Record<string, string>> {
  return {
    scopeId: scope.id,
    scopeKind: scope.kind,
    ...(scope.name ? { scopeName: scope.name } : {}),
  };
}
