/**
 * Redacted inspection evidence projected from request selection.
 *
 * @module
 */

import type { ProviderMediaHooks } from "../../adapter/native-chat/media-hooks";
import type { CallArgs } from "../../adapter/types";
import { estimateRequestTokens } from "../measure/estimate";
import {
  buildRequestCandidate,
  orderRepresentationPolicies,
} from "../planner/candidates";
import type { RequestAdaptation } from "./adaptations";
import type { RequestInspectionEvidence } from "./inspection";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import { KNOWLEDGE_TRACE_METADATA_KEY } from "./knowledge";

/** Build content-free candidate, artifact, and linkage evidence. @internal */
export function requestInspectionEvidence<
  TExtra extends Record<string, unknown>,
>(input: {
  readonly request: CallArgs<TExtra>;
  readonly policies: readonly ResolvedRepresentationPolicy[];
  readonly selections: ReadonlyMap<string, number>;
  readonly adaptations: readonly RequestAdaptation[];
  readonly provider: string;
  readonly maxInputTokens: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly media?: ProviderMediaHooks;
  readonly previousRequestId?: string;
}): RequestInspectionEvidence {
  const policies = orderRepresentationPolicies(input.policies);
  const selectedVector = policies.map(
    (policy) => input.selections.get(policy.contributor) ?? 0,
  );
  const contributions = new Map<string, {
    readonly id: string;
    readonly sources: readonly string[];
    readonly priority: number;
    readonly boundary: "required" | "sticky" | "elastic";
    readonly representations: readonly string[];
  }>();
  const ownedSources = new Set(
    policies.flatMap((policy) => policy.sources),
  );
  for (const block of input.request.systemBlocks ?? []) {
    if (ownedSources.has(block.source) || contributions.has(block.source)) {
      continue;
    }
    contributions.set(block.source, Object.freeze({
      id: block.source,
      sources: Object.freeze([block.source]),
      priority: 0,
      boundary: "required" as const,
      representations: Object.freeze(["full"]),
    }));
  }
  for (const policy of policies) {
    contributions.set(policy.contributor, Object.freeze({
      id: policy.contributor,
      sources: Object.freeze([...policy.sources]),
      priority: policy.priority,
      boundary: contributionBoundary(policy),
      representations: Object.freeze(
        policy.rungs.map((rung) => rung.kind),
      ),
    }));
  }
  const candidates = policies.flatMap((policy, policyIndex) =>
    policy.rungs.map((rung, rungIndex) => {
      const selected = selectedVector[policyIndex] === rungIndex;
      const inputTokens = rung.available
        ? estimateRequestTokens(
            buildRequestCandidate(
              input.request,
              policies,
              selectedVector.map((value, index) =>
                index === policyIndex ? rungIndex : value,
              ),
            ).request,
            {
              provider: input.provider,
              ...(input.media ? { media: input.media } : {}),
            },
          ).inputTokens
        : undefined;
      return Object.freeze({
        contributor: policy.contributor,
        representation: rung.kind,
        available: rung.available,
        selected,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(!selected
          ? {
              rejectionReason: !rung.available
                ? "unprepared" as const
                : inputTokens !== undefined &&
                    inputTokens > input.maxInputTokens
                  ? "over-limit" as const
                  : "lower-fidelity" as const,
            }
          : {}),
      });
    }),
  );
  const artifacts = input.adaptations.flatMap((adaptation) =>
    adaptation.representation === "summary" ||
    adaptation.representation === "offload"
      ? [Object.freeze({
          contributor: adaptation.contributor,
          kind: adaptation.representation,
          supportRequestIds: Object.freeze([
            ...(adaptation.supportRequestIds ??
              (adaptation.supportRequestId
                ? [adaptation.supportRequestId]
                : [])),
          ]),
        })]
      : [],
  );
  const supportTools = [
    ...new Set(policies.flatMap((policy) => policy.supportToolNames ?? [])),
  ];
  const linkedRequestIds = [
    ...(input.previousRequestId ? [input.previousRequestId] : []),
    ...artifacts.flatMap((artifact) => artifact.supportRequestIds),
  ];
  return Object.freeze({
    contributions: Object.freeze([...contributions.values()]),
    candidates: Object.freeze(candidates),
    artifacts: Object.freeze(artifacts),
    knowledge: Object.freeze(knowledgeReceipts(input.metadata)),
    supportTools: Object.freeze(supportTools),
    linkedRequestIds: Object.freeze([...new Set(linkedRequestIds)]),
  });
}

function knowledgeReceipts(
  metadata: Readonly<Record<string, unknown>> | undefined,
): NonNullable<RequestInspectionEvidence["knowledge"]> {
  const value = metadata?.[KNOWLEDGE_TRACE_METADATA_KEY];
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.flatMap(projectKnowledgeTrace));
}

function projectKnowledgeTrace(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.steps)) return [];
  const traceId = stringField(value, "id");
  const recipeId = stringField(value, "recipeId");
  const fingerprint = stringField(value, "fingerprint");
  if (!traceId || !recipeId || !fingerprint) return [];
  return value.steps.flatMap((step) => {
    if (!isRecord(step) || !isRecord(step.knowledge)) return [];
    const knowledge = step.knowledge;
    const stepId = stringField(step, "stepId");
    const contributor = stringField(knowledge, "contributor");
    const coverage = stringField(knowledge, "coverage");
    const coverageBasis = stringField(knowledge, "coverageBasis");
    if (!stepId || !contributor || !coverage || !coverageBasis) return [];
    return [Object.freeze({
      traceId,
      recipeId,
      fingerprint,
      stepId,
      contributor,
      ...(isViewReceipt(knowledge.view) ? { view: knowledge.view } : {}),
      generations: Object.freeze(stringArray(knowledge.generations)),
      coverage,
      coverageBasis,
      ...(typeof knowledge.scan === "string" ? { scan: knowledge.scan } : {}),
      ...(typeof knowledge.detail === "string" ? { detail: knowledge.detail } : {}),
      counts: Object.freeze({
        available: countRecord(knowledge.available),
        processed: countRecord(knowledge.processed),
      }),
      ...(isPreflight(knowledge.preflight)
        ? { preflight: Object.freeze(knowledge.preflight) }
        : {}),
      truncations: Object.freeze(stringArray(knowledge.truncations)),
    })];
  });
}

function countRecord(value: unknown): { readonly reports: number; readonly findings?: number } {
  if (!isRecord(value) || typeof value.reports !== "number") {
    return Object.freeze({ reports: 0 });
  }
  return Object.freeze({
    reports: value.reports,
    ...(typeof value.findings === "number" ? { findings: value.findings } : {}),
  });
}

function isViewReceipt(value: unknown): value is { readonly id: string; readonly viewRevision: string | null } {
  return isRecord(value) &&
    typeof value.id === "string" &&
    (typeof value.viewRevision === "string" || value.viewRevision === null);
}

function isPreflight(value: unknown): value is {
  readonly reports: number;
  readonly batches: number;
  readonly inputChars: number;
  readonly calls: number;
} {
  return isRecord(value) &&
    typeof value.reports === "number" &&
    typeof value.batches === "number" &&
    typeof value.inputChars === "number" &&
    typeof value.calls === "number";
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contributionBoundary(
  policy: ResolvedRepresentationPolicy,
): "required" | "sticky" | "elastic" {
  const representations = policy.rungs.map((rung) => rung.kind);
  return representations.includes("omitted")
    ? "elastic"
    : representations.length > 1
      ? "sticky"
      : "required";
}
