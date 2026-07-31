/**
 * Full redacted request evidence and bounded standalone retention.
 *
 * @module
 */

import type { ModelCountingConfidence } from "../capacity/model-profile";
import type { RequestTokenBreakdown } from "../measure/breakdown";
import type { RequestKnowledgeInspection } from "./knowledge";
import {
  preparationDecision,
  type PreparationDecisionInspection,
} from "../prepare/journal";
import type { RequestReceipt } from "./receipt";
import { supportRequestReceipt } from "./support";
import { currentObservabilityTransport } from "../../observability/observe";
import { validatedRequestInspection } from "./inspection-validation";

const RETENTION_LIMIT = 256;
const RETENTION_MS = 5 * 60_000;
const retained = new Map<string, RetainedInspection>();

/** One contributor identity and its authorized representation vocabulary. */
export interface RequestContributionInspection {
  /** Stable contributor identity. */
  readonly id: string;
  /** Resolver source identities owned by the contributor. */
  readonly sources: readonly string[];
  /** Selection priority. */
  readonly priority: number;
  /** Highest pressure boundary authorized by the contributor. */
  readonly boundary: "required" | "sticky" | "elastic";
  /** Authorized representation kinds in fidelity order. */
  readonly representations: readonly string[];
}

/** One redacted complete-request candidate decision. */
export interface RequestCandidateInspection {
  /** Stable contributor identity. */
  readonly contributor: string;
  /** Candidate representation kind. */
  readonly representation: string;
  /** Whether required preparation was available. */
  readonly available: boolean;
  /** Whether this rung was selected. */
  readonly selected: boolean;
  /** Estimated complete-request size for this candidate. */
  readonly inputTokens?: number;
  /** Why an unselected candidate lost. */
  readonly rejectionReason?:
    | "over-limit"
    | "lower-fidelity"
    | "unprepared";
}

/** Artifact and cache evidence associated with one selected adaptation. */
export interface RequestArtifactInspection {
  /** Contributor that owns the derived representation. */
  readonly contributor: string;
  /** Derived representation kind. */
  readonly kind: "summary" | "offload";
  /** Linked bounded support requests, when any. */
  readonly supportRequestIds: readonly string[];
}

/** Redacted linked support-call facts retained with live inspection. */
export interface RequestSupportReceipt {
  /** Support request identity linked from the adaptation. */
  readonly id: string;
  /** Concrete support model. */
  readonly model: string;
  /** Measured support-call input tokens. */
  readonly inputTokens: number;
  /** Effective support-call input maximum. */
  readonly maxInputTokens: number;
  /** Support-call measurement confidence. */
  readonly measurement: ModelCountingConfidence;
}

/** Full redacted evidence retained for one executed provider request. */
export interface RequestInspection {
  /** Request identity shared with the small receipt. */
  readonly id: string;
  /** Redacted contributor identities and authorized ladders. */
  readonly contributions: readonly RequestContributionInspection[];
  /** Candidate decisions and rejection reasons. */
  readonly candidates: readonly RequestCandidateInspection[];
  /** Redacted token attribution by contribution class. */
  readonly breakdown: RequestTokenBreakdown;
  /** Measurement confidence used for the fit decision. */
  readonly measurement: ModelCountingConfidence;
  /** Counting confidence and reserved margins. */
  readonly counting: {
    readonly measurement: ModelCountingConfidence;
    readonly attribution: RequestTokenBreakdown["attribution"];
    readonly safetyMarginTokens: number;
    readonly providerOverheadTokens: number;
  };
  /** Number of provider transport retries for this sealed request. */
  readonly retryCount: number;
  /** Derived artifact and cache evidence. */
  readonly artifacts: readonly RequestArtifactInspection[];
  /** Connected-knowledge receipt projections, present when a recipe contributed. */
  readonly knowledge?: readonly RequestKnowledgeInspection[];
  /** Required support Tool identities in the selected request family. */
  readonly supportTools: readonly string[];
  /** Receipted support calls linked from selected adaptations. */
  readonly supportRequests: readonly RequestSupportReceipt[];
  /** Previous and support request identities linked from this request. */
  readonly linkedRequestIds: readonly string[];
  /** Accepted content-free preparation decision for this provider call. */
  readonly preparation?: PreparationDecisionInspection;
  /** Cross-process inspection requires the existing observability pipeline. */
  readonly retention: "requires observability retention";
}

/** Static evidence captured when a request is sealed. @internal */
export interface RequestInspectionEvidence {
  readonly contributions?: readonly RequestContributionInspection[];
  readonly candidates?: readonly RequestCandidateInspection[];
  readonly artifacts?: readonly RequestArtifactInspection[];
  readonly knowledge?: readonly RequestKnowledgeInspection[];
  readonly supportTools?: readonly string[];
  readonly linkedRequestIds?: readonly string[];
}

/** Standalone inspection could not be found in current retention. */
export class RequestInspectionUnavailableError extends Error {
  override readonly name = "RequestInspectionUnavailableError";
  /** Stable machine-readable failure code. */
  readonly code = "REQUEST_INSPECTION_UNAVAILABLE";

  /** Create a content-free retention failure. */
  constructor() {
    super(
      "Request inspection is no longer available; configure observability retention for cross-process lookup.",
    );
  }
}

/**
 * Inspect a live or recently serialized request receipt.
 *
 * @param receiptOrId - Live receipt, serialized receipt, or request id.
 * @returns Full redacted evidence while retained.
 * @throws {@link RequestInspectionUnavailableError} after expiry or eviction.
 */
export async function inspectRequest(
  receiptOrId: RequestReceipt | { readonly id: string } | string,
): Promise<RequestInspection> {
  if (
    typeof receiptOrId === "object" &&
    "inspect" in receiptOrId &&
    typeof receiptOrId.inspect === "function"
  ) {
    return receiptOrId.inspect();
  }
  const id =
    typeof receiptOrId === "string" ? receiptOrId : receiptOrId.id;
  const entry = retained.get(id);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.inspect();
  }
  if (entry) {
    retained.delete(id);
  }
  const destination = currentObservabilityTransport()?.requestInspection;
  if (destination) {
    try {
      const inspection = validatedRequestInspection(
        await destination.inspectRequest(id),
        id,
      );
      if (inspection) return inspection;
    } catch {
      // The public failure remains content-free and destination-agnostic.
    }
  }
  throw new RequestInspectionUnavailableError();
}

/** Retain one lazy inspection builder and return its live reader. @internal */
export function retainRequestInspection(
  id: string,
  inspect: () => RequestInspection,
): () => RequestInspection {
  retained.delete(id);
  retained.set(id, {
    expiresAt: Date.now() + RETENTION_MS,
    inspect,
  });
  while (retained.size > RETENTION_LIMIT) {
    const oldest = retained.keys().next().value;
    if (oldest === undefined) break;
    retained.delete(oldest);
  }
  return inspect;
}

/** Assemble immutable inspection evidence from a live receipt. @internal */
export function requestInspection(input: {
  readonly receipt: RequestReceipt;
  readonly breakdown: RequestTokenBreakdown;
  readonly measurement: ModelCountingConfidence;
  readonly safetyMarginTokens: number;
  readonly providerOverheadTokens: number;
  readonly retryCount: number;
  readonly evidence?: RequestInspectionEvidence;
}): RequestInspection {
  const preparation = preparationDecision(input.receipt);
  const supportRequests = linkedSupportRequests(
    input.evidence?.linkedRequestIds ?? [],
  );
  return Object.freeze({
    id: input.receipt.id,
    contributions: freezeArray(input.evidence?.contributions),
    candidates: freezeArray(input.evidence?.candidates),
    breakdown: input.breakdown,
    measurement: input.measurement,
    counting: Object.freeze({
      measurement: input.measurement,
      attribution: input.breakdown.attribution,
      safetyMarginTokens: input.safetyMarginTokens,
      providerOverheadTokens: input.providerOverheadTokens,
    }),
    retryCount: input.retryCount,
    artifacts: freezeArray(input.evidence?.artifacts),
    knowledge: freezeArray(input.evidence?.knowledge),
    supportTools: Object.freeze([...(input.evidence?.supportTools ?? [])]),
    supportRequests,
    linkedRequestIds: Object.freeze([
      ...(input.evidence?.linkedRequestIds ?? []),
    ]),
    ...(preparation ? { preparation } : {}),
    retention: "requires observability retention" as const,
  });
}

interface RetainedInspection {
  readonly expiresAt: number;
  readonly inspect: () => RequestInspection;
}

function linkedSupportRequests(
  ids: readonly string[],
): readonly RequestSupportReceipt[] {
  return Object.freeze(
    [...new Set(ids)].flatMap((id) => {
      const linked = supportRequestReceipt(id);
      return linked
        ? [Object.freeze({
            id: linked.id,
            model: linked.model,
            inputTokens: linked.inputTokens,
            maxInputTokens: linked.maxInputTokens,
            measurement: linked.measurement,
          })]
        : [];
    }),
  );
}

function freezeArray<T>(values: readonly T[] | undefined): readonly T[] {
  return Object.freeze([...(values ?? [])]);
}
