import { expectTypeOf } from "vitest";
import {
  createCruxArtifactId,
  createCruxRunId,
  createCruxSpanId,
  evidence,
  type EvidenceArtifactRef,
  type EvidenceAcceptedAfterTerminal,
  type EvidenceEffectReceiptRef,
  type EvidenceDestinationRoleResult,
  type EvidenceExecutionRef,
  type EvidenceRecord,
  type EvidenceRef,
} from "../src";
import { evidence as subpathEvidence } from "../src/evidence";

expectTypeOf(subpathEvidence).toEqualTypeOf<typeof evidence>();

const durableIntentSummary = {
  role: "intent",
  status: "present",
  activeRecordCount: 0,
  records: [],
  conflicting: false,
  truncated: true,
} as const satisfies EvidenceDestinationRoleResult<"intent">;
expectTypeOf(durableIntentSummary.status).toEqualTypeOf<"present">();

// @ts-expect-error Durable destination summaries require an explicit status.
const missingDurableStatus: EvidenceDestinationRoleResult<"intent"> = {
  role: "intent",
  records: [],
  conflicting: false,
  truncated: false,
};
void missingDurableStatus;

const verification = evidence.record({
  role: "verification",
  conclusion: "passed",
  kind: "custom.review",
  data: { ok: true },
});

expectTypeOf(verification).toEqualTypeOf<
  EvidenceRef<"verification">
>();

expectTypeOf(
  evidence.record({
    role: "intent",
    kind: "custom.plan",
    data: { goal: "publish" },
  }),
).toEqualTypeOf<EvidenceRef<"intent">>();
expectTypeOf(
  evidence.record({
    role: "authority",
    conclusion: "revoked",
    kind: "custom.approval",
    data: null,
  }),
).toEqualTypeOf<EvidenceRef<"authority">>();
expectTypeOf(
  evidence.record({
    role: "change",
    conclusion: "no-change",
    kind: "custom.diff",
    data: [],
  }),
).toEqualTypeOf<EvidenceRef<"change">>();
expectTypeOf(
  evidence.record({
    role: "recovery",
    conclusion: "partial",
    kind: "custom.rollback",
    data: false,
  }),
).toEqualTypeOf<EvidenceRef<"recovery">>();

evidence.record({
  role: "authority",
  // @ts-expect-error Authority evidence cannot use a verification conclusion.
  conclusion: "passed",
  kind: "custom.approval",
  data: {},
});

evidence.record({
  role: "intent",
  // @ts-expect-error Intent is provenance and never has a conclusion.
  conclusion: "inconclusive",
  kind: "custom.plan",
  data: {},
});

// @ts-expect-error Inline application evidence must use a custom.* kind.
evidence.record({
  role: "verification",
  kind: "score.report",
  data: { score: 1 },
});

const artifact = {
  kind: "artifact",
  id: createCruxArtifactId(),
} as const satisfies EvidenceArtifactRef;

const queryRecordBase = {
  ref: verification,
  source: artifact,
  supersedes: [],
} as const;

const retainedRecord = {
  ...queryRecordBase,
  payloadState: "redacted",
  payloadUnavailableReason: "retention",
} as const satisfies EvidenceRecord<"verification">;
expectTypeOf(retainedRecord.payloadUnavailableReason).toEqualTypeOf<
  "retention"
>();

const acceptedAfterTerminal = {
  judgedAgainst: {
    kind: "run",
    id: createCruxRunId(),
  },
} as const satisfies EvidenceAcceptedAfterTerminal;
expectTypeOf(acceptedAfterTerminal.judgedAgainst.kind).toEqualTypeOf<"run">();

const invalidUnavailableReason: EvidenceRecord<"verification"> = {
  ...queryRecordBase,
  payloadState: "reference",
  // @ts-expect-error Unavailable reasons exist only on redacted records.
  payloadUnavailableReason: "retention",
};
void invalidUnavailableReason;

const invalidTerminalFact: EvidenceAcceptedAfterTerminal = {
  // @ts-expect-error Presence is the proof; false is not part of the contract.
  afterTerminal: false,
};
void invalidTerminalFact;

// @ts-expect-error One evidence record has exactly one source.
evidence.record({
  role: "verification",
  ref: artifact,
  kind: "score.report",
  data: { copied: true },
});

// @ts-expect-error Evidence must provide inline data or an existing reference.
evidence.record({
  role: "verification",
  conclusion: "inconclusive",
});

const runSubject = {
  kind: "execution",
  id: createCruxRunId(),
} as const satisfies EvidenceExecutionRef;
const spanSubject = {
  kind: "execution",
  id: createCruxSpanId(),
} as const satisfies EvidenceExecutionRef;
const receiptSubject = {
  kind: "effect.receipt",
  id: "receipt_1",
  effectId: "cms.publish",
} as const satisfies EvidenceEffectReceiptRef;

for (const subject of [runSubject, spanSubject, artifact, receiptSubject]) {
  evidence.inspect(subject);
}

// @ts-expect-error Execution subjects require canonical branded IDs.
evidence.inspect({ kind: "execution", id: "run_unbranded" });

evidence.record({
  role: "verification",
  kind: "custom.review-retry",
  data: {},
  supersedes: verification,
});

const authority = evidence.record({
  role: "authority",
  kind: "custom.policy",
  data: {},
});
// @ts-expect-error Supersession is correlated to the new record's role.
evidence.record({
  role: "verification",
  kind: "custom.review",
  data: {},
  supersedes: authority,
});
