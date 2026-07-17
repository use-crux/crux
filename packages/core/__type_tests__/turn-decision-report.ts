import { expectTypeOf } from "vitest";
import type {
  TurnCacheEvidence,
  TurnConsideredItem,
  TurnDecisionReason,
  TurnDecisionReasonCode,
  TurnDecisionReport,
  TurnEvidenceLevel,
  TurnFreshnessEvidence,
  TurnSawItem,
} from "@use-crux/core/observability";

const report = {
  schemaVersion: 1,
  reportId: "tdr:run_1:turn_1",
  runId: "run_1",
  turn: {
    id: "turn_1",
    kind: "generation.call",
    model: "gpt-5",
    provider: "openai",
    status: "ok",
    finishReason: "stop",
    durMs: 1200,
    tokens: { input: 1000, output: 200, total: 1200 },
    cost: { totalUsd: 0.01 },
    readout: "Answered with one dropped context and partial quality coverage.",
  },
  saw: [
    {
      kind: "context",
      id: "ctx_customer",
      name: "customerProfile",
      disposition: "active",
      tokens: 250,
      evidenceLevel: "observed",
      sourceStatus: "used",
      tab: { tab: "Context", artifactId: "artifact_ctx" },
    },
  ],
  considered: [
    {
      kind: "context",
      id: "ctx_policy",
      name: "policyDocs",
      disposition: "dropped",
      reasonState: "budget",
      reason: {
        code: "context.dropped.token_budget",
        text: "Dropped by the prompt budget.",
        source: "artifact",
        evidenceLevel: "declared",
      },
      evidenceLevel: "declared",
      sourceStatus: "dropped",
      required: true,
      tab: { tab: "Context", anchorId: "ctx_policy" },
    },
  ],
  freshness: [
    {
      subject: { kind: "context", id: "ctx_customer", name: "customerProfile" },
      status: "fresh",
      ageMs: 500,
      maxAgeMs: 60000,
      evidenceLevel: "observed",
    },
  ],
  cache: [
    {
      subject: { kind: "cache", id: "resolver:customerProfile" },
      status: "hit",
      cacheKey: "customerProfile:v1",
      acceptedByFreshness: true,
      savedTokens: 250,
      evidenceLevel: "observed",
      tab: { tab: "Cache" },
    },
  ],
  decisions: [
    {
      id: "decision_budget",
      phase: "request",
      kind: "prompt-budget",
      subject: { kind: "prompt-budget", id: "budget:turn_1" },
      outcome: "dropped ctx_policy",
      reason: {
        code: "budget.applied",
        text: "Prompt budget was applied.",
        source: "artifact",
        evidenceLevel: "declared",
      },
      tab: { tab: "Context" },
      evidence: [
        {
          kind: "artifact",
          artifactId: "artifact_budget",
          artifactKind: "prompt.budget",
          role: "budget",
        },
      ],
      metrics: { tokens: 250 },
    },
  ],
  source: [
    {
      group: "Contexts",
      items: [
        {
          id: "ctx_customer",
          kind: "context",
          name: "customerProfile",
          file: "src/crux.ts",
          line: 12,
          status: "used",
          fidelity: "exact",
        },
      ],
    },
  ],
  coverage: {
    covered: 1,
    total: 6,
    areas: [
      {
        id: "context-inclusion",
        label: "Context inclusion",
        status: "partial",
        suggestion: "Assert context customerProfile is included",
        command: "crux eval support-routing",
      },
    ],
  },
  gaps: [
    {
      code: "freshness.partial",
      text: "Some freshness evidence was not recorded.",
      evidenceLevel: "missing",
      subject: { kind: "context", id: "ctx_policy" },
    },
  ],
  chips: [
    {
      id: "saw",
      label: "Saw 1",
      tone: "neutral",
      filter: { target: "saw" },
    },
  ],
} satisfies TurnDecisionReport;

expectTypeOf(report.saw[0]).toMatchTypeOf<TurnSawItem>();
expectTypeOf(report.considered[0]).toMatchTypeOf<TurnConsideredItem>();
expectTypeOf(report.freshness[0]).toMatchTypeOf<TurnFreshnessEvidence>();
expectTypeOf(report.cache[0]).toMatchTypeOf<TurnCacheEvidence>();
expectTypeOf<"custom.billing_policy">().toExtend<TurnDecisionReasonCode>();
expectTypeOf<"unknown.provider_specific">().toExtend<TurnDecisionReasonCode>();
expectTypeOf<TurnEvidenceLevel>().toEqualTypeOf<
  "declared" | "observed" | "inferred" | "missing"
>();

const missingReason = {
  code: "reason.missing",
  text: "Reason was not recorded.",
  source: "not-recorded",
  evidenceLevel: "missing",
} satisfies TurnDecisionReason;

expectTypeOf(missingReason.evidenceLevel).toEqualTypeOf<"missing">();

const inferredReason = {
  code: "unknown.runtime",
  text: "Projected from incomplete evidence.",
  source: "projection",
  evidenceLevel: "inferred",
} satisfies TurnDecisionReason;

expectTypeOf(inferredReason.evidenceLevel).toEqualTypeOf<"inferred">();

// @ts-expect-error - not-recorded reasons must be marked as missing evidence.
const invalidMissingReason: TurnDecisionReason = {
  code: "reason.missing",
  text: "Reason was not recorded.",
  source: "not-recorded",
  evidenceLevel: "inferred",
};

void invalidMissingReason;

const invalidSawItem = {
  kind: "context",
  // @ts-expect-error - saw items are only for content that reached the model.
  disposition: "checked",
  evidenceLevel: "observed",
  sourceStatus: "used",
} satisfies TurnSawItem;

void invalidSawItem;
