import { describe, expect, it } from "vitest";

import {
  decodeEvalHostResult,
  encodeEvalHostResult,
} from "../../../src/runtime/eval-host/result-codec";
import { fingerprintEvalValue } from "../../../src/eval/internal/identity";

const evidence = {
  output: "yes",
  response: {
    runId: "run-provider-1",
    content: [],
    text: "yes",
    steps: [],
    finalStep: {
      content: [],
      text: "yes",
      finishReason: "stop",
      responseId: "response-1",
      modelId: "model-1",
      warnings: [],
    },
    messages: [],
    warnings: [],
  },
  capturedSignals: ["modelCalls"],
  runIds: ["run-provider-1"],
  metrics: { durationMs: 2, costUsd: 0.01 },
  observedIdentity: {
    reusable: true as const,
    fingerprintMaterial: { model: "model-1" },
  },
};

describe("Eval host result codec", () => {
  it("hashes adapter identity before the canonical envelope crosses the wire", () => {
    const privateEvidence = {
      ...evidence,
      renderedPromptFingerprint: fingerprintEvalValue({
        rendered: "private system prompt",
      }),
      observedIdentity: {
        reusable: true as const,
        fingerprintMaterial: {
          prompt: "private system prompt",
          context: { customer: "private@example.test" },
          tools: [{ name: "admin" }],
          routing: { model: "private-model-route" },
        },
      },
    };
    const encoded = encodeEvalHostResult({
      jobId: "job-1",
      evalRunId: "eval-run-1",
      evidence: privateEvidence,
    });

    expect(encoded).toMatchObject({
      renderedPromptFingerprint: privateEvidence.renderedPromptFingerprint,
      observedIdentity: {
        reusable: true,
        fingerprint: fingerprintEvalValue(
          privateEvidence.observedIdentity.fingerprintMaterial,
        ),
      },
    });
    expect(JSON.stringify(encoded)).not.toContain("fingerprintMaterial");
    expect(JSON.stringify(encoded)).not.toContain("private system prompt");
    expect(JSON.stringify(encoded)).not.toContain("private@example.test");
    expect(JSON.stringify(encoded)).not.toContain("private-model-route");

    expect(
      decodeEvalHostResult(encoded, {
        jobId: "job-1",
        evalRunId: "eval-run-1",
      }),
    ).toMatchObject({
      observedIdentity: {
        reusable: true,
        fingerprint: fingerprintEvalValue(
          privateEvidence.observedIdentity.fingerprintMaterial,
        ),
      },
    });
  });

  it.each([
    "model_identity_unattested",
    "unresolved_source_dependency",
  ] as const)(
    "round-trips the %s identity without treating execution as failed",
    (reason) => {
      const freshEvidence = {
        ...evidence,
        observedIdentity: {
          reusable: false as const,
          reason,
        },
      };
      const encoded = encodeEvalHostResult({
        jobId: "job-1",
        evalRunId: "eval-run-1",
        evidence: freshEvidence,
      });

      expect(
        decodeEvalHostResult(encoded, {
          jobId: "job-1",
          evalRunId: "eval-run-1",
        }).observedIdentity,
      ).toEqual(freshEvidence.observedIdentity);
    },
  );

  it.each([
    ["unknown envelope field", { extra: true }],
    ["non-finite duration", { metrics: { durationMs: Infinity } }],
    [
      "impossible reusable identity",
      { observedIdentity: { reusable: true, reason: "identity_unavailable" } },
    ],
    ["incomplete response", { response: { text: "yes" } }],
  ])("rejects %s", (_label, replacement) => {
    const encoded = encodeEvalHostResult({
      jobId: "job-1",
      evalRunId: "eval-run-1",
      evidence,
    });
    const malformed = { ...encoded, ...replacement };

    expect(() =>
      decodeEvalHostResult(malformed, {
        jobId: "job-1",
        evalRunId: "eval-run-1",
      }),
    ).toThrow(/incompatible result/i);
  });

  it("rejects a valid result replayed for another admitted job", () => {
    const encoded = encodeEvalHostResult({
      jobId: "job-1",
      evalRunId: "eval-run-1",
      evidence,
    });

    expect(() =>
      decodeEvalHostResult(encoded, {
        jobId: "job-2",
        evalRunId: "eval-run-1",
      }),
    ).toThrow(/incompatible result/i);
  });

  it("accepts an older host result without rendered identity so reuse can fail closed", () => {
    const encoded = encodeEvalHostResult({
      jobId: "job-1",
      evalRunId: "eval-run-1",
      evidence,
    }) as Record<string, unknown>;
    const { renderedPromptFingerprint: _missing, ...older } = encoded;

    expect(
      decodeEvalHostResult(older, {
        jobId: "job-1",
        evalRunId: "eval-run-1",
      }).renderedPromptFingerprint,
    ).toBeUndefined();
  });
});
