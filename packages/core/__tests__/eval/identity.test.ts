import { describe, expect, it } from "vitest";

import {
  createTaskEvidenceIdentity,
  fingerprintEvalValue,
  isReusableEvalValue,
  OUTPUT_CACHE_EPOCH,
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

    expect(OUTPUT_CACHE_EPOCH).toBe(3);
    expect(identity.key).toBe(
      "24189be77705a09acb1945c51c18e23ce258cbded7473df969e660467ab2e986",
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
  });
});
