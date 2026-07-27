import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval";
import { coordinateNodeEval } from "../../src/eval/node/coordinator";
import type { HydratedEval } from "../../src/eval/node/cases";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import { scorers } from "../../src/eval/internal/scorers/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Node managed scorer host", () => {
  it("injects experimental Eval per-call pricing into task estimation", async () => {
    const estimateCost = vi.fn((request) => ({
      kind: "known" as const,
      maximumUsd: request.pricing!["provider/model"]!.maxUsdPerCall,
      source: "config_override" as const,
    }));
    const task = attachEvalTaskDescriptorForInternalUse(
      Object.assign(async () => "unused", { _tag: "CruxTask" as const }),
      {
        _tag: "CruxEvalTaskDescriptor",
        identityEpoch: 2,
        operation: "generate",
        adapterId: "ai-sdk",
        capabilities: [],
        defaults: {},
        overrideKeys: [],
        projectIdentity: () => ({
          reusable: true,
          fingerprintMaterial: { task: "priced-v1" },
        }),
        estimateCost,
        execute: async () => ({ output: "yes" }),
        projectOutput: (result) => result.output,
        projectResponse: () => ({
          runId: "task-run",
          content: [],
          text: "yes",
          steps: [],
          finalStep: {
            content: [],
            text: "yes",
            finishReason: "stop",
            responseId: "response-1",
            modelId: "provider/model",
            warnings: [],
          },
          messages: [],
          warnings: [],
        }),
      },
    );
    const value = evaluate({
      id: "priced",
      task,
      cases: [{ id: "case", input: "question" }],
    });
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-price-"));
    roots.push(projectRoot);
    await writeFile(
      join(projectRoot, "crux.config.mjs"),
      `export default { config: { experimental: { eval: { pricing: { "provider/model": { maxUsdPerCall: 0.25 } } } } } };`,
    );

    const coordinated = await coordinateNodeEval(
      {
        id: "priced",
        eval: value,
        sourceKey: { relativeFile: "priced.eval.ts", export: "default" },
        sidecarFile: "priced.cases.jsonl",
        links: [],
        cases: [],
        caseFileDependencies: [],
        definitionFingerprint: "definition-v1",
        sourceClosure: {
          reusable: true,
          fingerprint: "source-v1",
          taskSourceFingerprint: "task-source-v1",
          dependencies: [],
        },
      },
      { maxCostUsd: 0.25 },
      projectRoot,
    );

    expect(estimateCost).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing: { "provider/model": { maxUsdPerCall: 0.25 } },
      }),
    );
    expect(coordinated.plan.cost.admission).toMatchObject({
      status: "admitted",
      costControl: "max_cost",
    });
  });

  it("executes a judge with the managed task's actual adapter and model binding", async () => {
    const generate = vi.fn(async () => ({
      object: { reasoning: "grounded", score: 0.9 },
      usage: {
        inputTokens: 9,
        outputTokens: 3,
        totalTokens: 12,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      cost: 0.04,
    }));
    const task = attachEvalTaskDescriptorForInternalUse(
      Object.assign(async () => "unused", { _tag: "CruxTask" as const }),
      {
        _tag: "CruxEvalTaskDescriptor",
        identityEpoch: 2,
        operation: "generate",
        adapterId: "ai-sdk",
        capabilities: [],
        defaults: {},
        overrideKeys: [],
        projectIdentity: () => ({
          reusable: true,
          fingerprintMaterial: { task: "v1" },
        }),
        projectScorerContext: () => ({
          reusable: true,
          fingerprintMaterial: { adapter: "fake", model: "judge-v1" },
        }),
        createScorerContext: () => ({
          generate: generate as never,
          model: "judge-v1",
        }),
        execute: async () => ({ output: "yes" }),
        projectOutput: (result) => result.output,
        projectResponse: () => ({
          runId: "task-run",
          content: [],
          text: "yes",
          steps: [],
          finalStep: {
            content: [],
            text: "yes",
            finishReason: "stop",
            responseId: "response-1",
            modelId: "task-model",
            warnings: [],
          },
          messages: [],
          warnings: [],
        }),
      },
    );
    const value = evaluate({
      id: "bound-judge",
      task,
      cases: [{ id: "case", input: "question", expected: "yes" }],
      scorers: [scorers.judge({ name: "helpful", rubric: "Is it helpful?" })],
    });
    const entry = {
      id: "bound-judge",
      eval: value,
      sourceKey: { relativeFile: "bound-judge.eval.ts", export: "default" },
      sidecarFile: "bound-judge.cases.jsonl",
      links: [],
      cases: [],
      caseFileDependencies: [],
      definitionFingerprint: "definition-v1",
      sourceClosure: {
        reusable: true,
        fingerprint: "source-v1",
        taskSourceFingerprint: "task-source-v1",
        dependencies: [],
      },
    } satisfies HydratedEval;
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-judge-"));
    roots.push(projectRoot);

    const coordinated = await coordinateNodeEval(
      entry,
      { confirmUnknownCost: true },
      projectRoot,
    );
    const admittedContract = coordinated.plan.cells[0]?.scorerContracts[0];
    expect(admittedContract).toMatchObject({
      name: "helpful",
      contractFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const run = await coordinated.execute();

    expect(generate).toHaveBeenCalledOnce();
    expect(run.cells[0]?.scorerContracts).toEqual([admittedContract]);
    expect(run.cells[0]?.scores[0]).toMatchObject({
      status: "computed",
      reason: "managed_external_executed",
      value: 0.9,
      metrics: {
        actualUsd: 0.04,
        usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
      },
      contractFingerprint: admittedContract?.contractFingerprint,
    });
    expect(run.cost).toMatchObject({
      actualUsd: 0.04,
      task: {},
      judge: { actualUsd: 0.04 },
    });
  });
});
