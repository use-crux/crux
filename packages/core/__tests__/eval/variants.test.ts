import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";

const task = Object.assign(async () => "unused", {
  _tag: "CruxTask" as const,
  operation: "function" as const,
});

function definition() {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" } }],
    variants: { cheaper: { temperature: 0 } },
    expect: ({ output, expect: assert }) => assert(output).toBe("yes"),
  });
}

function ports(outputs: Record<string, string> = {}): {
  readonly ports: EvalExecutionPorts;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async (request: { readonly variant: string }) => {
    const output = outputs[request.variant] ?? "yes";
    return {
      output,
      response: {
        content: [],
        text: output,
        steps: [],
        finalStep: {
          content: [],
          text: output,
          finishReason: "stop",
          responseId: `response-${request.variant}`,
          modelId: "fake",
          warnings: [],
        },
        messages: [],
        warnings: [],
      },
      capturedSignals: [],
      runIds: [`task-run-${request.variant}`],
      metrics: { durationMs: 1 },
      observedIdentity: {
        reusable: false as const,
        reason: "identity_unavailable" as const,
      },
    };
  });
  return {
    execute,
    ports: {
      taskHost: { execute },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    },
  };
}

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("Current and candidate Variants", () => {
  it("runs Current first and every declared candidate by default", async () => {
    const harness = ports();
    const plan = await planEval(definition(), source);
    const run = await executeEvalPlan(plan, harness.ports);

    expect(plan.cells.map((cell) => cell.variant)).toEqual([
      "current",
      "cheaper",
    ]);
    expect(
      harness.execute.mock.calls.map(([request]) => request.variant),
    ).toEqual(["current", "cheaper"]);
    expect(harness.execute.mock.calls[1]?.[0]).toMatchObject({
      overrides: { temperature: 0 },
    });
    expect(run).toMatchObject({
      status: "complete",
      passed: true,
      blockingVariants: ["current"],
      cells: [
        { variant: "current", status: "passed" },
        { variant: "cheaper", status: "passed" },
      ],
      variants: [
        { name: "current", blocking: true, overrideKeys: [] },
        { name: "cheaper", blocking: false, overrideKeys: ["temperature"] },
      ],
    });
  });

  it("keeps a candidate failure informational on a default run", async () => {
    const harness = ports({ cheaper: "no" });
    const run = await executeEvalPlan(
      await planEval(definition(), source),
      harness.ports,
    );

    expect(run).toMatchObject({
      status: "complete",
      passed: true,
      blockingVariants: ["current"],
      cells: [
        { variant: "current", status: "passed" },
        { variant: "cheaper", status: "failed" },
      ],
      gates: {
        passed: true,
        blockingPassed: true,
        results: [
          { gate: "pass", variantName: "current", passed: true },
          {
            gate: "pass",
            variantName: "cheaper",
            passed: false,
            informational: true,
          },
        ],
      },
    });
  });

  it("retains Current and makes an explicitly selected candidate blocking", async () => {
    const harness = ports({ cheaper: "no" });
    const selectedDefinition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      variants: {
        cheaper: { temperature: 0 },
        premium: { temperature: 0.8 },
      },
      expect: ({ output, expect: assert }) => assert(output).toBe("yes"),
    });
    const run = await executeEvalPlan(
      await planEval(selectedDefinition, { ...source, variant: "cheaper" }),
      harness.ports,
    );

    expect(run).toMatchObject({
      status: "complete",
      passed: false,
      blockingVariants: ["current", "cheaper"],
      variants: [
        { name: "current", blocking: true },
        { name: "cheaper", blocking: true },
      ],
      gates: { passed: false, blockingPassed: false },
    });
    expect(run.cells.map((cell) => cell.variant)).toEqual([
      "current",
      "cheaper",
    ]);
    expect(run.gates.results[1]).not.toHaveProperty("informational");
  });

  it("resolves task replacement separately from adapter overrides", async () => {
    const replacement = Object.assign(async () => "replacement", {
      _tag: "CruxTask" as const,
      operation: "function" as const,
    });
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      variants: {
        replacement: { task: replacement, temperature: 0 },
      },
    });
    const plan = await planEval(evalValue, source);

    expect(plan.cells[1]).toMatchObject({
      variant: "replacement",
      task: replacement,
      overrides: { temperature: 0 },
    });
    expect(plan.cells[1]?.overrides).not.toHaveProperty("task");
  });

  it("lets a failing Current cell block a default run", async () => {
    const harness = ports({ current: "no" });
    const run = await executeEvalPlan(
      await planEval(definition(), source),
      harness.ports,
    );

    expect(run).toMatchObject({
      status: "complete",
      passed: false,
      blockingVariants: ["current"],
      cells: [
        { variant: "current", status: "failed" },
        { variant: "cheaper", status: "passed" },
      ],
    });
  });

  it.each(["baseline", "missing"])(
    "rejects the '%s' selector before identity or execution work",
    async (variant) => {
      const describe = vi.fn();
      await expect(
        planEval(
          definition(),
          { ...source, variant },
          {
            evidenceStore: {
              identity: "memory",
              consistency: "read_after_write",
              read: vi.fn(),
              write: vi.fn(),
            },
            taskIdentity: { describe },
          },
        ),
      ).rejects.toThrow(variant === "baseline" ? "reserved" : "unknown");
      expect(describe).not.toHaveBeenCalled();
    },
  );
});
