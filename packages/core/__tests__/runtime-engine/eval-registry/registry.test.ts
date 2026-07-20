import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../../../src/eval";
import { attachEvalTaskDescriptorForInternalUse } from "../../../src/eval/internal/task";
import {
  createDeployedEvalRegistry,
  DeployedEvalRegistryError,
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
  resolveDeployedEval,
} from "../../../src/runtime/eval-registry";

function managedTask() {
  return attachEvalTaskDescriptorForInternalUse(
    async (input: { message: string }) => input.message,
    {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["asset-store"],
      defaults: {},
      overrideKeys: ["temperature"],
      projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }),
      execute: async (input) => ({ output: input }),
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({ output: result.output }),
    },
  );
}

function hostedTask() {
  return attachEvalTaskDescriptorForInternalUse(
    async (input: { message: string }) => input.message,
    {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["asset-store"],
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { task: "hosted" },
      }),
      execute: async (input) => ({ output: input }),
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({ output: result.output }),
    },
  );
}

describe("deployed Eval registry", () => {
  it("advertises every arm identity but resolves only runtime arms", () => {
    const evalValue = evaluate({
      id: "mixed",
      task: async (input: { message: string }) => input.message,
      cases: [{ id: "case", input: { message: "hello" } }],
      variants: { hosted: { task: hostedTask() } } as never,
    });
    const authored = { id: "case", input: { message: "hello" } } as const;
    const variants = projectDeployedEvalVariants(evalValue);
    const registry = createDeployedEvalRegistry({
      entries: [
        {
          eval: evalValue,
          id: "mixed",
          source: "evals/mixed.eval.ts",
          evalFingerprint: "eval",
          cases: [
            {
              id: "case",
              fingerprint: fingerprintDeployedEvalCase("case", authored),
              authored,
            },
          ],
          variants,
          runtimeArms: [
            { name: "hosted", requiredHostCapabilities: ["asset-store"] },
          ],
          requiredHostCapabilities: ["asset-store"],
          index: {
            id: "mixed",
            source: "evals/mixed.eval.ts",
            requiredHostCapabilities: ["asset-store"],
          },
        },
      ],
    });
    const request = {
      evalId: "mixed",
      evalFingerprint: "eval",
      caseId: "case",
      caseFingerprint: fingerprintDeployedEvalCase("case", authored),
    };

    expect(registry.entries[0]?.variants).toHaveLength(2);
    expect(() =>
      resolveDeployedEval(registry, {
        ...request,
        variant: "current",
        variantFingerprint: variants[0]!.fingerprint,
      }),
    ).toThrowError(expect.objectContaining({ code: "variant_missing" }));
    expect(
      resolveDeployedEval(registry, {
        ...request,
        variant: "hosted",
        variantFingerprint: variants[1]!.fingerprint,
      }).variant.name,
    ).toBe("hosted");
  });

  it("resolves one exact Eval, Case, and Variant tuple", () => {
    const task = managedTask();
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { message: "refund" } }],
      variants: { concise: { temperature: 0 } },
    });
    const authored = { id: "refund", input: { message: "refund" } } as const;
    const registry = createDeployedEvalRegistry({
      entries: [
        {
          eval: evalValue,
          id: "support",
          source: "evals/support.eval.ts",
          evalFingerprint: "eval-fingerprint",
          cases: [
            {
              id: "refund",
              fingerprint: fingerprintDeployedEvalCase("refund", authored),
              authored,
            },
          ],
          variants: projectDeployedEvalVariants(evalValue),
          runtimeArms: [
            { name: "current", requiredHostCapabilities: ["asset-store"] },
            { name: "concise", requiredHostCapabilities: ["asset-store"] },
          ],
          requiredHostCapabilities: ["asset-store"],
          index: {
            id: "support",
            source: "evals/support.eval.ts",
            requiredHostCapabilities: ["asset-store"],
          },
        },
      ],
    });

    const resolved = resolveDeployedEval(registry, {
      evalId: "support",
      evalFingerprint: "eval-fingerprint",
      caseId: "refund",
      caseFingerprint: fingerprintDeployedEvalCase("refund", authored),
      variant: "concise",
      variantFingerprint:
        projectDeployedEvalVariants(evalValue)[1]!.fingerprint,
    });

    expect(resolved.case.authored.input).toEqual({ message: "refund" });
    expect(resolved.variant).toMatchObject({
      name: "concise",
      overrides: { temperature: 0 },
      task,
    });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(resolved.case)).toBe(true);
  });

  it("rejects stale identity before exposing an executor", () => {
    const execute = vi.fn();
    const task = attachEvalTaskDescriptorForInternalUse(execute, {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["asset-store"],
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }),
      execute: async () => ({ output: "ok" }),
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({ output: result.output }),
    });
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: {} }],
    });
    const authored = { id: "refund", input: {} } as const;
    const registry = createDeployedEvalRegistry({
      entries: [
        {
          eval: evalValue,
          id: "support",
          source: "evals/support.eval.ts",
          evalFingerprint: "fresh",
          cases: [
            {
              id: "refund",
              fingerprint: fingerprintDeployedEvalCase("refund", authored),
              authored,
            },
          ],
          variants: projectDeployedEvalVariants(evalValue),
          runtimeArms: [
            { name: "current", requiredHostCapabilities: ["asset-store"] },
          ],
          requiredHostCapabilities: ["asset-store"],
          index: {
            id: "support",
            source: "evals/support.eval.ts",
            requiredHostCapabilities: ["asset-store"],
          },
        },
      ],
    });

    expect(() =>
      resolveDeployedEval(registry, {
        evalId: "support",
        evalFingerprint: "stale",
        caseId: "refund",
        caseFingerprint: fingerprintDeployedEvalCase("refund", authored),
        variant: "current",
        variantFingerprint:
          projectDeployedEvalVariants(evalValue)[0]!.fingerprint,
      }),
    ).toThrow(/stale Eval fingerprint/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when Project Index corroboration disagrees", () => {
    const evalValue = evaluate({
      id: "support",
      task: managedTask(),
      cases: [{ id: "refund", input: {} }],
    });

    expect(() =>
      createDeployedEvalRegistry({
        entries: [
          {
            eval: evalValue,
            id: "support",
            source: "evals/support.eval.ts",
            evalFingerprint: "eval",
            cases: [
              {
                id: "refund",
                fingerprint: "case",
                authored: { id: "refund", input: {} },
              },
            ],
            variants: [{ name: "current", fingerprint: "current" }],
            runtimeArms: [],
            requiredHostCapabilities: ["asset-store"],
            index: {
              id: "support",
              source: "evals/support.eval.ts",
              requiredHostCapabilities: [],
            },
          },
        ],
      }),
    ).toThrow(/Project Index.*disagrees.*asset-store/i);
  });

  it("classifies every missing or stale tuple component before execution", () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const task = attachEvalTaskDescriptorForInternalUse(
      async (input: unknown) => input,
      {
        _tag: "CruxEvalTaskDescriptor",
        operation: "generate",
        adapterId: "ai-sdk",
        capabilities: [],
        requiredHostCapabilities: ["asset-store"],
        defaults: {},
        overrideKeys: [],
        projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }),
        execute,
        projectOutput: (result) => result.output,
        projectResponse: (result) => ({ output: result.output }),
      },
    );
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: {} }],
    });
    const authored = { id: "refund", input: {} } as const;
    const caseFingerprint = fingerprintDeployedEvalCase("refund", authored);
    const variantFingerprint =
      projectDeployedEvalVariants(evalValue)[0]!.fingerprint;
    const registry = createDeployedEvalRegistry({
      entries: [
        {
          eval: evalValue,
          id: "support",
          source: "evals/support.eval.ts",
          evalFingerprint: "eval",
          cases: [{ id: "refund", fingerprint: caseFingerprint, authored }],
          variants: projectDeployedEvalVariants(evalValue),
          runtimeArms: [
            { name: "current", requiredHostCapabilities: ["asset-store"] },
          ],
          requiredHostCapabilities: ["asset-store"],
          index: {
            id: "support",
            source: "evals/support.eval.ts",
            requiredHostCapabilities: ["asset-store"],
          },
        },
      ],
    });
    const valid = {
      evalId: "support",
      evalFingerprint: "eval",
      caseId: "refund",
      caseFingerprint,
      variant: "current",
      variantFingerprint,
    };
    const failures = [
      [{ ...valid, evalId: "missing" }, "eval_missing"],
      [{ ...valid, caseId: "missing" }, "case_missing"],
      [{ ...valid, caseFingerprint: "stale" }, "case_stale"],
      [{ ...valid, variant: "missing" }, "variant_missing"],
      [{ ...valid, variantFingerprint: "stale" }, "variant_stale"],
    ] as const;

    for (const [request, code] of failures) {
      try {
        resolveDeployedEval(registry, request);
        expect.unreachable(`expected ${code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(DeployedEvalRegistryError);
        expect(error).toMatchObject({ code });
      }
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
