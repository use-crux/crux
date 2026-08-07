import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluate } from "../../src/eval/evaluate";
import {
  getEvalDefinitionForInternalUse,
  type EvalDefinitionV1,
} from "../../src/eval/internal/definition";
import {
  createTaskEvidenceIdentity,
  fingerprintEvalValue,
  isReusableEvalValue,
  TASK_EVIDENCE_CACHE_EPOCH,
} from "../../src/eval/internal/identity";
import { fingerprintEvalDefinition } from "../../src/eval/node/definition-identity";
import { fingerprintDeployedEvalCase } from "../../src/runtime/eval-registry/projection";

describe("portable Eval evidence identity", () => {
  it("matches the cross-runtime golden without Node hashing APIs", () => {
    const identity = createTaskEvidenceIdentity({
      evalId: "support",
      caseId: "refund",
      input: { locale: "en", question: "Can I get a refund?" },
      call: { temperature: 0 },
      variant: "current",
      trial: 0,
      timeout: {},
      managedTaskFingerprint: "task-v1",
      adapterFingerprint: "prompt-model-tools-v1",
      hostContractFingerprint: "local-host-v1",
      occurrence: "root",
    });

    expect(TASK_EVIDENCE_CACHE_EPOCH).toBe(13);
    expect(identity.key).toBe(
      "ec5bc860035cfc17a10c40dc353ee664988708c52b7f3af1130f343e9d5e1939",
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

  it("fingerprints effective Case timeout policies semantically", () => {
    const first = timeoutDefinition({
      timeout: {
        totalMs: 5_000.9,
        stepMs: 2_000,
        tools: { search: 500.9, compose: 750 },
      },
      cases: [
        { id: "same", input: "same" },
        { id: "changed", input: "changed", timeout: { stepMs: 1_000 } },
      ],
    });
    const second = timeoutDefinition({
      timeout: {
        tools: { compose: 750.9, search: 500 },
        stepMs: 2_000.9,
        totalMs: 5_000,
      },
      cases: [
        { id: "same", input: "same" },
        { id: "changed", input: "changed", timeout: { stepMs: 250 } },
      ],
    });

    expect(caseFingerprint(first, 0)).toBe(caseFingerprint(second, 0));
    expect(caseFingerprint(first, 1)).not.toBe(caseFingerprint(second, 1));

    const disabled = [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY].map(
      (stepMs) =>
        caseFingerprint(
          timeoutDefinition({
            timeout: { stepMs },
            cases: [{ id: "disabled", input: "disabled" }],
          }),
          0,
        ),
    );
    expect(new Set(disabled)).toHaveLength(1);

    const clearAll = timeoutDefinition({
      timeout: {
        totalMs: 5_000,
        stepMs: 2_000,
        tools: { search: 500 },
      },
      cases: [{ id: "clear", input: "clear", timeout: null }],
    });
    const explicitClear = timeoutDefinition({
      timeout: {
        totalMs: 5_000,
        stepMs: 2_000,
        tools: { search: 500 },
      },
      cases: [
        {
          id: "clear",
          input: "clear",
          timeout: {
            totalMs: null,
            stepMs: null,
            tools: { search: null },
          },
        },
      ],
    });
    expect(caseFingerprint(clearAll, 0)).toBe(
      caseFingerprint(explicitClear, 0),
    );
  });

  it("includes canonical Eval and Case timeout policy in definition identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-eval-timeout-identity-"));
    const sourceFile = "identity.eval.ts";
    await writeFile(join(root, sourceFile), "export default null;\n");
    try {
      const base = timeoutDefinition({
        timeout: { totalMs: 5_000, stepMs: 2_000 },
        cases: [{ id: "one", input: "one" }],
      });
      const changedEval = timeoutDefinition({
        timeout: { totalMs: 1_000, stepMs: 2_000 },
        cases: [{ id: "one", input: "one" }],
      });
      const changedCase = timeoutDefinition({
        timeout: { totalMs: 5_000, stepMs: 2_000 },
        cases: [{ id: "one", input: "one", timeout: { stepMs: 250 } }],
      });
      const equivalent = timeoutDefinition({
        timeout: { stepMs: 2_000.9, totalMs: 5_000.9 },
        cases: [{ id: "one", input: "one" }],
      });

      const fingerprints = await Promise.all(
        [base, changedEval, changedCase, equivalent].map((definition) =>
          definitionFingerprint(root, sourceFile, definition),
        ),
      );

      expect(fingerprints[0]).not.toBe(fingerprints[1]);
      expect(fingerprints[0]).not.toBe(fingerprints[2]);
      expect(fingerprints[0]).toBe(fingerprints[3]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function timeoutDefinition(input: {
  readonly timeout?: Parameters<typeof evaluate>[0]["timeout"];
  readonly cases: readonly Readonly<Record<string, unknown>>[];
}): EvalDefinitionV1 {
  return getEvalDefinitionForInternalUse(
    evaluate({
      id: "timeout-identity",
      task: async (value: string) => value,
      timeout: input.timeout,
      cases: input.cases as never,
    }),
  );
}

function caseFingerprint(definition: EvalDefinitionV1, index: number): string {
  const authored = definition.cases[index]!;
  const evalValue = evaluate({
    id: definition.explicitId!,
    task: async (value: string) => value,
    timeout: definition.timeout,
    cases: definition.cases as never,
  });
  return fingerprintDeployedEvalCase(
    evalValue,
    authored.id ?? String(index),
    authored,
  );
}

async function definitionFingerprint(
  projectRoot: string,
  relativeFile: string,
  definition: EvalDefinitionV1,
): Promise<string> {
  const identity = await fingerprintEvalDefinition({
    projectRoot,
    definition,
    discovered: {
      id: definition.explicitId!,
      eval: evaluate({
        id: definition.explicitId!,
        task: async (value: string) => value,
        cases: [{ input: "placeholder" }],
      }),
      sourceKey: { relativeFile, export: "default" },
      sidecarFile: "identity.cases.jsonl",
      links: [],
    },
    cases: definition.cases.map((authored, index) => ({
      id: authored.id ?? String(index),
      origin: `${relativeFile}:inline:${index + 1}`,
      authored,
      unvalidatedExpected: false,
    })),
    caseFileDependencies: [],
  });
  return identity.fingerprint;
}
