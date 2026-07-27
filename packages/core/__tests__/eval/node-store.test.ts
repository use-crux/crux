import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createEvalEvidenceFileStore,
  createEvalRunFileStore,
  evalRunV3Schema,
  isEvalRunPromotable,
} from "../../src/eval/node/stores";
import { runV4StoreBehavior } from "./run-v4-store.behavior";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  evalValue,
  nonBillablePlanningPorts,
  planningPorts,
  taskResult,
} from "./reuse-test-harness";
import { runFixture } from "./baseline-test-harness";
const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("Node Eval run stores", () => {
  runV4StoreBehavior();
  it("rejects impossible task and score discriminator combinations", () => {
    const fixture = runFixture({ score: 1 });
    const cell = fixture.cells[0]!;
    for (const invalid of [
      {
        ...fixture,
        cells: [{ ...cell, task: { status: "reused", reason: "task_error" } }],
      },
      {
        ...fixture,
        cells: [
          {
            ...cell,
            scores: [
              {
                ...cell.scores[0],
                status: "reused",
                reason: "managed_external_reused",
                work: {
                  status: "executed",
                  reason: "no_exact_evidence",
                  reservation: "consumed",
                },
              },
            ],
          },
        ],
      },
      {
        ...fixture,
        cells: [
          {
            ...cell,
            scores: [
              {
                status: "errored",
                reason: "scorer_error",
                name: "helpful",
                contractFingerprint: "helpful-v1",
                value: 1,
                message: "failed",
              },
            ],
          },
        ],
      },
    ]) {
      expect(evalRunV3Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("validates the shared golden while preserving additive fields", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("./fixtures/run-v3.golden.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(evalRunV3Schema.parse(raw)).toMatchObject({
      futureTopLevelField: { producer: "future-core", revision: 4 },
      cells: [{ futureCellField: { preserve: true } }],
    });
  });

  it("atomically round-trips a complete run from the terminal boundary", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-run-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const evidenceStore = createEvalEvidenceFileStore({ projectRoot });
    const run = await executeEvalPlan(
      await planEval(evalValue(), source, planningPorts(evidenceStore)),
      {
        evidenceStore,
        taskHost: { execute: async () => taskResult() },
        clock: { now: vi.fn().mockReturnValueOnce(100).mockReturnValue(125) },
        ids: { next: () => "eval-run-1" },
        runStore,
      },
    );

    await expect(runStore.read("eval-run-1")).resolves.toEqual({
      status: "found",
      run,
    });
    expect(isEvalRunPromotable(run)).toBe(true);
  });

  it("persists an incomplete run as non-promotable terminal evidence", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-error-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const run = await executeEvalPlan(
      await planEval(evalValue(), source, nonBillablePlanningPorts()),
      {
        taskHost: {
          execute: async () => {
            throw new Error("provider unavailable");
          },
        },
        clock: { now: vi.fn().mockReturnValueOnce(100).mockReturnValue(125) },
        ids: { next: () => "eval-run-error" },
        runStore,
      },
    );

    expect(run).toMatchObject({ status: "incomplete", passed: false });
    expect(isEvalRunPromotable(run)).toBe(false);
    await expect(runStore.read("eval-run-error")).resolves.toMatchObject({
      status: "found",
      run: { status: "incomplete", passed: false },
    });
  });

  it("keeps a complete failing run eligible for explicit Baseline acceptance", () => {
    expect(
      isEvalRunPromotable({ ...runFixture({ score: 0 }), passed: false }),
    ).toBe(true);
  });

  it("redacts secrets and bounds output snapshots before persistence", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-redact-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const run = await executeEvalPlan(
      await planEval(evalValue(), source, nonBillablePlanningPorts()),
      {
        taskHost: {
          execute: async () =>
            taskResult({
              authorization: "Bearer secret",
              body: "x".repeat(40_000),
            }),
        },
        clock: { now: () => 100 },
        ids: { next: () => "eval-run-redacted" },
        runStore,
      },
    );

    expect(run.cells[0]?.output).toMatchObject({
      authorization: "Bearer secret",
    });
    const persisted = await runStore.read("eval-run-redacted");
    expect(persisted).toMatchObject({
      status: "found",
      run: {
        cells: [
          {
            output: expect.stringContaining("[truncated]"),
          },
        ],
      },
    });
    expect(JSON.stringify(persisted)).not.toContain("Bearer secret");
  });

  it("omits an oversized response envelope without failing the terminal run write", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-response-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const result = taskResult("yes");
    const run = await executeEvalPlan(
      await planEval(evalValue(), source, nonBillablePlanningPorts()),
      {
        taskHost: {
          execute: async () => ({
            ...result,
            response: { ...result.response, text: "x".repeat(40_000) },
          }),
        },
        clock: { now: () => 100 },
        ids: { next: () => "eval-run-large-response" },
        runStore,
      },
    );

    expect(run.cells[0]?.response?.text).toHaveLength(40_000);
    await expect(runStore.read(run.runId)).resolves.toMatchObject({
      status: "found",
      run: {
        cells: [
          {
            responseOmitted: "persistence_size_limit",
          },
        ],
      },
    });
    const persisted = await runStore.read(run.runId);
    if (persisted.status !== "found") throw new TypeError("run missing");
    expect(persisted.run.cells[0]).not.toHaveProperty("response");
  });

  it.each([
    {
      name: "provider-owned metadata",
      patch: { providerMetadata: { receivedAt: new Date(0) } },
    },
    {
      name: "inline binary content",
      patch: { content: [{ type: "file", data: new Uint8Array([1, 2, 3]) }] },
    },
  ])(
    "omits a persistence-unsafe $name response without losing the run",
    async ({ name, patch }) => {
      const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-response-"));
      const runStore = createEvalRunFileStore({ projectRoot });
      const result = taskResult("yes");
      const run = await executeEvalPlan(
        await planEval(evalValue(), source, nonBillablePlanningPorts()),
        {
          taskHost: {
            execute: async () => ({
              ...result,
              response: { ...result.response, ...patch } as never,
            }),
          },
          clock: { now: () => 100 },
          ids: { next: () => `eval-run-unsafe-${name.replaceAll(" ", "-")}` },
          runStore,
        },
      );

      expect(run.status).toBe("complete");
      const persisted = await runStore.read(run.runId);
      expect(persisted).toMatchObject({
        status: "found",
        run: {
          cells: [{ responseOmitted: "persistence_unsafe" }],
        },
      });
      if (persisted.status !== "found") throw new TypeError("run missing");
      expect(persisted.run.cells[0]).not.toHaveProperty("response");
    },
  );

  it("round-trips an own __proto__ response key without prototype mutation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-response-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const result = taskResult("yes");
    const providerMetadata = JSON.parse(
      '{"__proto__":{"kept":true},"provider":"fixture"}',
    ) as Record<string, unknown>;
    const run = await executeEvalPlan(
      await planEval(evalValue(), source, nonBillablePlanningPorts()),
      {
        taskHost: {
          execute: async () => ({
            ...result,
            response: { ...result.response, providerMetadata } as never,
          }),
        },
        clock: { now: () => 100 },
        ids: { next: () => "eval-run-proto-response" },
        runStore,
      },
    );

    const persisted = await runStore.read(run.runId);
    if (persisted.status !== "found") throw new TypeError("run missing");
    const metadata = persisted.run.cells[0]?.response?.providerMetadata as
      | Record<string, unknown>
      | undefined;
    expect(metadata).toBeDefined();
    expect(Object.hasOwn(metadata!, "__proto__")).toBe(true);
    expect(metadata?.__proto__).toEqual({ kept: true });
    expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype);
  });

  it("applies one internal path policy to persisted run snapshots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-policy-"));
    const runStore = createEvalRunFileStore({
      projectRoot,
      persistencePolicy: { redactPaths: ["customer.email"] },
    });
    const fixture = runFixture({ score: 1 });
    await runStore.write({
      ...fixture,
      runId: "eval-run-policy",
      cells: fixture.cells.map((cell) => ({
        ...cell,
        input: { customer: { email: "private@example.test", id: "c-1" } },
        output: { customer: { email: "private@example.test", id: "c-1" } },
      })),
    });

    await expect(runStore.read("eval-run-policy")).resolves.toMatchObject({
      status: "found",
      run: {
        cells: [
          {
            input: { customer: { email: "[redacted]", id: "c-1" } },
            output: { customer: { email: "[redacted]", id: "c-1" } },
          },
        ],
      },
    });
  });

  it.each([
    ["Date", new Date("2026-01-01T00:00:00.000Z")],
    ["Map", new Map([["answer", 42]])],
    ["Set", new Set(["answer"])],
    [
      "class instance",
      new (class Answer {
        value = 42;
      })(),
    ],
  ])(
    "rejects a non-plain %s snapshot instead of persisting a lossy object",
    async (_kind, value) => {
      const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-plain-"));
      const runStore = createEvalRunFileStore({ projectRoot });
      const fixture = runFixture({ score: 1 });
      const runId = `eval-run-${String(_kind).replaceAll(" ", "-")}`;

      await expect(
        runStore.write({
          ...fixture,
          runId,
          cells: fixture.cells.map((cell) => ({ ...cell, input: value })),
        }),
      ).rejects.toThrow(/snapshot.*plain objects.*arrays.*primitive/i);
      await expect(runStore.read(runId)).resolves.toEqual({
        status: "missing",
      });
    },
  );

  it("reports corrupt final records and ignores abandoned temporary files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-corrupt-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const runsDir = join(projectRoot, ".crux", "evals", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "corrupt.json"),
      '{"schemaVersion":3',
      "utf8",
    );
    await writeFile(
      join(runsDir, "abandoned.json.partial.tmp"),
      '{"schemaVersion":3}',
      "utf8",
    );

    await expect(runStore.read("corrupt")).resolves.toMatchObject({
      status: "corrupt",
      error: expect.any(String),
    });
    await expect(runStore.read("abandoned")).resolves.toEqual({
      status: "missing",
    });
  });

  it("reuses exact evidence after reopening the filesystem store", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-cache-"));
    const firstStore = createEvalEvidenceFileStore({ projectRoot });
    const execute = vi.fn(async () => taskResult());
    await executeEvalPlan(
      await planEval(evalValue(), source, planningPorts(firstStore)),
      {
        evidenceStore: firstStore,
        taskHost: { execute },
        clock: { now: () => 1 },
        ids: { next: () => "eval-run-1" },
        runStore: { write: async () => undefined },
      },
    );

    const reopened = createEvalEvidenceFileStore({ projectRoot });
    const plan = await planEval(evalValue(), source, planningPorts(reopened));

    expect(plan.cells[0]?.action).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
