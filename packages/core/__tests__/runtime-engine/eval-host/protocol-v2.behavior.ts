import { expect, it } from "vitest";

import {
  CRUX_EVAL_HOST_PROTOCOL_V1,
  CRUX_EVAL_HOST_PROTOCOL_V2,
  decodeEvalHostJobStatusV1,
  decodeEvalHostJobStatusV2,
  decodeSubmitEvalJobV1,
  decodeSubmitEvalJobV2,
  EVAL_HOST_MAX_DEADLINE_HORIZON_MS,
} from "../../../src/runtime/eval-host";

const NOW = new Date("2026-07-16T18:00:00.000Z");

/** Register strict legacy-read and current-write protocol behavior. */
export function defineEvalHostProtocolV2Behavior(): void {
  it("decodes V1 separately while requiring V2 deadline and expiration metadata", () => {
    expect(
      decodeSubmitEvalJobV1(JSON.stringify(v1Submission()), NOW),
    ).toMatchObject({
      protocol: CRUX_EVAL_HOST_PROTOCOL_V1,
      deadlineAt: "2026-07-16T18:01:00.000Z",
    });
    expect(
      decodeSubmitEvalJobV2(JSON.stringify(v2Submission()), NOW),
    ).toMatchObject({
      protocol: CRUX_EVAL_HOST_PROTOCOL_V2,
      deadline: { source: "eval", limitMs: 60_000 },
    });

    const common = {
      jobId: "job-1",
      evalRunId: "run-1",
      attempt: 1,
      revision: 3,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      status: "expired" as const,
      error: {
        code: "EVAL_JOB_DEADLINE_EXCEEDED",
        message: "The Eval job deadline elapsed.",
        retryable: false as const,
        phase: "execute" as const,
      },
    };
    expect(decodeEvalHostJobStatusV1(common)).toEqual(common);
    expect(
      decodeEvalHostJobStatusV2({
        ...common,
        timeout: {
          budget: "total",
          limitMs: 60_000,
          phase: "in_flight",
        },
      }),
    ).toMatchObject({
      status: "expired",
      timeout: {
        budget: "total",
        limitMs: 60_000,
        phase: "in_flight",
      },
    });
  });

  it("rejects V2 terminal timeout limits beyond the bounded admission horizon", () => {
    expect(() =>
      decodeEvalHostJobStatusV2({
        ...terminalStatus(),
        timeout: {
          budget: "total",
          limitMs: EVAL_HOST_MAX_DEADLINE_HORIZON_MS + 1,
          phase: "in_flight",
        },
      }),
    ).toThrow(/incompatible job status/i);
  });

  it("accepts the exact optional Tool name semantics of V2 timeout metadata", () => {
    expect(
      decodeEvalHostJobStatusV2({
        ...terminalStatus(),
        timeout: {
          budget: "tool",
          limitMs: 500,
          phase: "in_flight",
        },
      }),
    ).toMatchObject({
      timeout: { budget: "tool", limitMs: 500, phase: "in_flight" },
    });
  });

  it.each([
    [
      "missing expiration metadata",
      () => decodeEvalHostJobStatusV2(terminalStatus()),
    ],
    [
      "metadata on a running status",
      () =>
        decodeEvalHostJobStatusV2({
          ...terminalStatus(),
          status: "running",
          revision: 2,
          timeout: {
            budget: "total",
            limitMs: 25,
            phase: "in_flight",
          },
        }),
    ],
    [
      "unknown terminal metadata",
      () =>
        decodeEvalHostJobStatusV2({
          ...terminalStatus(),
          timeout: {
            budget: "total",
            limitMs: 25,
            phase: "in_flight",
            unexpected: true,
          },
        }),
    ],
    [
      "non-canonical terminal timestamp",
      () =>
        decodeEvalHostJobStatusV2({
          ...terminalStatus(),
          updatedAt: "2026-07-16T18:00:00Z",
          timeout: {
            budget: "total",
            limitMs: 25,
            phase: "in_flight",
          },
        }),
    ],
  ])("rejects V2 status with %s", (_label, decode) => {
    expect(decode).toThrow(/incompatible job status/i);
  });

  it.each([
    [
      "missing deadline metadata",
      () => {
        const { deadline: _missing, ...value } = v2Submission();
        return decodeSubmitEvalJobV2(JSON.stringify(value), NOW);
      },
    ],
    [
      "unknown submission field",
      () =>
        decodeSubmitEvalJobV2(
          JSON.stringify({ ...v2Submission(), unexpected: true }),
          NOW,
        ),
    ],
    [
      "non-canonical deadline timestamp",
      () =>
        decodeSubmitEvalJobV2(
          JSON.stringify({
            ...v2Submission(),
            deadlineAt: "2026-07-16T18:01:00Z",
          }),
          NOW,
        ),
    ],
    [
      "non-positive relative limit",
      () =>
        decodeSubmitEvalJobV2(
          JSON.stringify({
            ...v2Submission(),
            deadline: { source: "eval", limitMs: 0 },
          }),
          NOW,
        ),
    ],
  ])("rejects V2 submission with %s", (_label, decode) => {
    expect(decode).toThrow();
  });
}

function v1Submission() {
  return {
    ...identity(),
    protocol: CRUX_EVAL_HOST_PROTOCOL_V1,
    deadlineAt: "2026-07-16T18:01:00.000Z",
  };
}

function v2Submission() {
  return {
    ...identity(),
    protocol: CRUX_EVAL_HOST_PROTOCOL_V2,
    deadlineAt: "2026-07-16T18:01:00.000Z",
    deadline: { source: "eval", limitMs: 60_000 },
  };
}

function identity() {
  return {
    jobId: "job-1",
    evalRunId: "run-1",
    evalId: "support",
    evalFingerprint: "eval-v1",
    caseId: "refund",
    caseFingerprint: "case-v1",
    variant: "current",
    variantFingerprint: "variant-v1",
    trial: 0,
  };
}

function terminalStatus() {
  return {
    jobId: "job-1",
    evalRunId: "run-1",
    attempt: 1,
    revision: 3,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    status: "expired",
    error: {
      code: "EVAL_JOB_DEADLINE_EXCEEDED",
      message: "The Eval job deadline elapsed.",
      retryable: false,
      phase: "execute",
    },
  };
}
