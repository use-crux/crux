/**
 * Native authority evidence for the tool-approval lifecycle.
 *
 * @internal
 * @module
 */

import type { EvidenceRef } from "../../evidence/record-types";
import {
  emitNativeEvidenceArtifact,
  nativeEvidenceArtifactRef,
  recordNativeEvidence,
  type NativeEvidenceArtifactCapability,
} from "../../evidence/internal";
import type { ToolModelOutput } from "../../types/tool";
import type {
  ToolApprovalReplayProvenance,
} from "../../tools/types";
import {
  approvalArtifactAttributes,
  approvalArtifactId,
} from "../../observability/approval-artifact";
import { observe, type OpenObservedSpan } from "../../observability";
import { reportPreparedObservabilityFailure } from "../../observability/observe";
import { emitToolApprovalObservation } from "./approval";
import type { CommittedApprovalReplayLifecycle } from "./approval-replay";

type CommittedReplay = Extract<
  ToolApprovalReplayProvenance,
  { readonly version: 2 }
>;

interface ApprovalObservationBase {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

interface RequestAuthorityOptions extends ApprovalObservationBase {
  readonly attempt: OpenObservedSpan;
  readonly observePolicyDecision?: () => void;
}

interface DecisionAuthorityOptions extends ApprovalObservationBase {
  readonly replay?: CommittedReplay;
  readonly status: "approved" | "denied";
  readonly reason?: string;
  readonly modelOutput?: ToolModelOutput;
  readonly modelOutputSize?: number;
}

export interface ToolApprovalDecisionEvidence {
  readonly artifact: NativeEvidenceArtifactCapability;
}

/**
 * Emit the pending request artifact and authority relationship.
 *
 * @remarks Failure to produce governed evidence never changes the approval
 * protocol. The caller falls back to its legacy replay envelope.
 */
export function emitToolApprovalRequestAuthority(
  options: RequestAuthorityOptions,
): CommittedApprovalReplayLifecycle | undefined {
  let lifecycle: CommittedApprovalReplayLifecycle | undefined;
  emitToolApprovalObservation("request", {
    ...observationFields(options),
    ...(options.observePolicyDecision
      ? { observePolicyDecision: options.observePolicyDecision }
      : {}),
    observeWithinSpan(producer) {
      const artifact = emitApprovalArtifact({
        approvalId: options.approvalId,
        kind: "approval.request",
        namespace: {
          operationId: options.attempt.operationId,
          runId: options.attempt.runId,
        },
        slot: "request",
        status: "requested",
      });
      if (!artifact) return;
      const artifactRef = nativeEvidenceArtifactRef(artifact);
      observe.edge({
        edgeType: "produced",
        from: { kind: "span", id: producer.spanId },
        to: { kind: "artifact", id: artifactRef.id },
      });
      const requestEvidence = recordNativeEvidence({
        artifact,
        subject: { kind: "execution", id: options.attempt.spanId },
        role: "authority",
        conclusion: "inconclusive",
      });
      lifecycle = {
        identityEpoch: 1,
        namespace: {
          operationId: options.attempt.operationId,
          runId: options.attempt.runId,
        },
        attempt: executionRef(options.attempt),
        requestProducer: executionRef(producer),
        requestArtifactId: artifactRef.id,
        requestEvidence,
      };
    },
  });
  return lifecycle;
}

/** Emit one valid terminal approval decision against the original attempt. */
export function emitToolApprovalDecisionAuthority(
  options: DecisionAuthorityOptions,
): ToolApprovalDecisionEvidence | undefined {
  let result: ToolApprovalDecisionEvidence | undefined;
  emitToolApprovalObservation(options.status, {
    ...observationFields(options),
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.modelOutput ? { modelOutput: options.modelOutput } : {}),
    ...(options.modelOutputSize !== undefined
      ? { modelOutputSize: options.modelOutputSize }
      : {}),
    ...(options.replay
      ? {
          observeWithinSpan(producerSpan) {
            const artifact = emitApprovalArtifact({
              approvalId: options.approvalId,
              kind: "approval.decision",
              namespace: options.replay!.namespace,
              slot: "decision",
              status: options.status,
            });
            if (!artifact) return;
            const artifactRef = nativeEvidenceArtifactRef(artifact);
            const producer = options.replay!;
            observe.edge({
              edgeType: "produced",
              from: { kind: "span", id: producerSpan.spanId },
              to: { kind: "artifact", id: artifactRef.id },
            });
            recordNativeEvidence({
              artifact,
              subject: {
                kind: "execution",
                id: producer.attempt.spanId,
              },
              role: "authority",
              conclusion:
                options.status === "approved" ? "allowed" : "denied",
              supersedes: producer.requestEvidence,
            });
            result = Object.freeze({ artifact });
          },
        }
      : {}),
  });
  return result;
}

/** Bind the accepted decision artifact directly to the resumed call. */
export function recordResumedToolApprovalAuthority(
  decision: ToolApprovalDecisionEvidence,
  spanId: OpenObservedSpan["spanId"],
): EvidenceRef<"authority"> {
  return recordNativeEvidence({
    artifact: decision.artifact,
    subject: { kind: "execution", id: spanId },
    role: "authority",
    conclusion: "allowed",
  });
}

function emitApprovalArtifact(options: {
  readonly approvalId: string;
  readonly kind: "approval.request" | "approval.decision";
  readonly namespace: CommittedReplay["namespace"];
  readonly slot: "request" | "decision";
  readonly status: "requested" | "approved" | "denied";
}): NativeEvidenceArtifactCapability | undefined {
  try {
    const attributes = approvalArtifactAttributes({
      domain: "crux.tool.approval",
      identityEpoch: 1,
      namespace: options.namespace,
      approvalId: options.approvalId,
      slot: options.slot,
    });
    return emitNativeEvidenceArtifact({
      artifactId: approvalArtifactId(attributes),
      kind: options.kind,
      contentType: "application/json",
      encoding: "json",
      preview: Object.freeze({ status: options.status }),
      attributes,
    });
  } catch {
    reportPreparedObservabilityFailure({
      ok: false,
      reason: "invalid",
      detail: ["Invalid protected tool approval artifact identity."],
    });
    return undefined;
  }
}

function executionRef(span: OpenObservedSpan): {
  readonly runId: OpenObservedSpan["runId"];
  readonly traceId: OpenObservedSpan["traceId"];
  readonly spanId: OpenObservedSpan["spanId"];
} {
  return Object.freeze({
    runId: span.runId,
    traceId: span.traceId,
    spanId: span.spanId,
  });
}

function observationFields(options: ApprovalObservationBase) {
  return {
    approvalId: options.approvalId,
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    input: options.input,
  };
}
