import { describe, expect, it } from "vitest";

import {
  createTaskEvidenceIdentity,
  fingerprintEvalValue,
  isReusableEvalValue,
  TASK_EVIDENCE_CACHE_EPOCH,
} from "../../src/eval/internal/identity";

describe("portable Eval evidence identity", () => {
  it("matches the cross-runtime golden without Node hashing APIs", () => {
    const identity = createTaskEvidenceIdentity({
      evalId: "support",
      caseId: "refund",
      input: { locale: "en", question: "Can I get a refund?" },
      call: { temperature: 0 },
      variant: "current",
      trial: 0,
      managedTaskFingerprint: "task-v1",
      adapterFingerprint: "prompt-model-tools-v1",
      hostContractFingerprint: "local-host-v1",
      occurrence: "root",
    });

    expect(TASK_EVIDENCE_CACHE_EPOCH).toBe(10);
    expect(identity.key).toBe(
      "bd2b0168fcc64c74f7bb261f3c17d36153800ed1582a9cd4ff7de052957b7699",
    );
    expect(identity.fingerprint).toBe(identity.key);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it("canonicalizes record key order and conservatively rejects implicit media", () => {
    expect(fingerprintEvalValue({ b: 2, a: 1 })).toBe(
      fingerprintEvalValue({ a: 1, b: 2 }),
    );
    expect(isReusableEvalValue({ image: new Uint8Array([1, 2, 3]) })).toBe(
      false,
    );
    expect(
      isReusableEvalValue({
        image: { ref: "sha256:abc", mediaType: "image/png" },
      }),
    ).toBe(true);
    expect(
      isReusableEvalValue({
        image: {
          type: "data",
          sha256: "abc",
          mediaType: "image/png",
        },
      }),
    ).toBe(true);
  });

  it("never aliases distinct JavaScript scalar and array values", () => {
    const fingerprints = [
      fingerprintEvalValue(undefined),
      fingerprintEvalValue(null),
      fingerprintEvalValue([undefined]),
      fingerprintEvalValue(new Array(1)),
      fingerprintEvalValue(Number.NaN),
      fingerprintEvalValue(Number.POSITIVE_INFINITY),
      fingerprintEvalValue(Number.NEGATIVE_INFINITY),
      fingerprintEvalValue(-0),
      fingerprintEvalValue(0),
    ];

    expect(new Set(fingerprints)).toHaveLength(fingerprints.length);
  });
});
