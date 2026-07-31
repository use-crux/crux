import {
  observe,
  type CapturedObservabilityContext,
  type EvidenceProducer,
} from "../observability";
import { evidenceSubjectRequiredError } from "./errors";
import {
  freezeEvidenceSubject,
  type EvidenceExecutionRef,
  type EvidenceSubject,
} from "./subjects";
import { currentEvidenceEffectReceiptSubject } from "./subject-context";
import { validateEvidenceSubject } from "./reference-validation";

/** Resolve the eager subject and producer context for a record call. @internal */
export function resolveEvidenceExecution(
  explicit: EvidenceSubject | undefined,
): {
  readonly context: CapturedObservabilityContext | undefined;
  readonly graphProducer: EvidenceProducer | undefined;
  readonly producer: EvidenceExecutionRef | undefined;
  readonly subject: EvidenceSubject;
} {
  const context = observe.captureContext();
  const producer = executionRef(context);
  const graphProducer = evidenceProducer(context);
  const effectReceipt = currentEvidenceEffectReceiptSubject();
  const subject = explicit
    ? freezeEvidenceSubject(explicit)
    : effectReceipt
      ? freezeEvidenceSubject(effectReceipt)
      : producer
        ? freezeEvidenceSubject(producer)
        : undefined;

  if (!subject) throw evidenceSubjectRequiredError();
  validateEvidenceSubject(subject);
  return Object.freeze({ context, graphProducer, producer, subject });
}

function executionRef(
  context: CapturedObservabilityContext | undefined,
): EvidenceExecutionRef | undefined {
  if (!context) return undefined;
  return Object.freeze({
    kind: "execution",
    id: context.currentSpanId ?? context.runId,
  });
}

function evidenceProducer(
  context: CapturedObservabilityContext | undefined,
): EvidenceProducer | undefined {
  if (!context) return undefined;
  return context.currentSpanId === undefined
    ? Object.freeze({ kind: "run", id: context.runId })
    : Object.freeze({ kind: "span", id: context.currentSpanId });
}
