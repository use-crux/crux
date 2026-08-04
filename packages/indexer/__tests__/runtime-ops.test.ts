import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  transition,
  type FlowId,
  type RuntimeTargetId,
  type TaskId,
  type WorkId,
} from "@use-crux/core/runtime";
import { flow } from "@use-crux/core/flow";
import {
  postgres,
  type PostgresRuntimeStore,
} from "@use-crux/postgres/runtime";
import { runRuntimeOperation } from "../src/indexer/runtime-ops";
import { runSetupOperation } from "../src/indexer/setup-ops";
import {
  closeRuntimeOpsPools,
  dropPostgresSchemas,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from "./runtime-ops-test-database";

const roots: string[] = [];
const schemas: string[] = [];
let database: PostgresTestDatabase;

const runtimeOpsReviewFlow = flow("runtime-ops-review", async (scope) => {
  await scope.step("new-label", () => "ok");
  await scope.suspend("approval");
});
void runtimeOpsReviewFlow;

describe("runtime operations", () => {
  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  });

  afterEach(async () => {
    await closeRuntimeOpsPools();
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  afterAll(async () => {
    await closeRuntimeOpsPools();
    try {
      await dropPostgresSchemas(database, schemas);
    } finally {
      await database.close();
    }
  });

  it("treats host-bound runtime preflight as metadata-only", async () => {
    const root = await mkdtemp(
      join(dirname(fileURLToPath(import.meta.url)), ".tmp-runtime-host-"),
    );
    roots.push(root);
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "import { config } from '@use-crux/core'",
        "export default config({ runtime: {",
        "  kind: 'host-bound', id: 'convex', host: 'convex',",
        "  entry: 'convex/_crux/generated.ts', capabilities: {},",
        "} as never })",
      ].join("\n"),
    );

    await expect(
      runRuntimeOperation({ root, operation: "preflight" }),
    ).resolves.toEqual({
      operation: "preflight",
      ok: true,
      setup: { ok: true, findings: [] },
      missingTargets: [],
    });
  });

  it("runs setup/status/inspect/retry/cancel against node({ store: postgres() })", async () => {
    const schema = `crux_runtime_ops_${Date.now()}`;
    schemas.push(schema);
    const root = await runtimeOpsFixtureRoot({ schema });

    await expect(
      runSetupOperation({ root, mode: "check" }),
    ).resolves.toMatchObject({
      ok: false,
      setup: { mode: "check", ok: false },
      generation: { status: "blocked" },
    });
    await expect(
      runSetupOperation({ root, mode: "apply" }),
    ).resolves.toMatchObject({
      ok: true,
      setup: { mode: "apply", ok: true },
      generation: { status: "generated" },
    });
    await expect(
      runSetupOperation({ root, mode: "check" }),
    ).resolves.toMatchObject({
      ok: true,
      setup: { mode: "check", ok: true },
      generation: { status: "current" },
    });

    const seedStore = postgres({
      url: database.url,
      schema,
      poolOptions: { allowExitOnIdle: true },
    });
    try {
      await seedReplayDivergedWork(seedStore);
      await seedCancellableWork(seedStore);
      await seedTimerAndOutbox(seedStore);
    } finally {
      await seedStore.close();
    }

    const status = await runRuntimeOperation({ root, operation: "status" });
    expect(status).toMatchObject({
      operation: "status",
      ok: true,
      counts: expect.arrayContaining([
        expect.objectContaining({
          status: "blocked",
          targetId: "runtime-ops-review",
          count: 1,
        }),
        expect.objectContaining({
          status: "pending",
          targetId: "runtime-ops-cancel",
          count: 1,
        }),
      ]),
    });

    await expect(
      runRuntimeOperation({ root, operation: "preflight" }),
    ).resolves.toMatchObject({
      operation: "preflight",
      ok: false,
      setup: { ok: true },
      missingTargets: [
        {
          targetId: "runtime-ops-cancel",
          count: 1,
        },
      ],
    });

    const detailedStatus = await runRuntimeOperation({
      root,
      operation: "status",
      includeDetails: true,
    });
    expect(detailedStatus).toMatchObject({
      operation: "status",
      ok: true,
      work: expect.arrayContaining([
        expect.objectContaining({
          workId: "work_runtime_ops_replay",
          status: "blocked",
          targetId: "runtime-ops-review",
        }),
      ]),
      timers: expect.arrayContaining([
        expect.objectContaining({
          timerId: expect.any(String),
          state: "scheduled",
          namespace: "local",
        }),
      ]),
      outbox: expect.arrayContaining([
        expect.objectContaining({
          outboxId: expect.any(String),
          state: "pending",
          namespace: "local",
        }),
      ]),
    });

    await expect(
      runRuntimeOperation({
        root,
        operation: "inspect",
        workId: "work_runtime_ops_replay",
      }),
    ).resolves.toMatchObject({
      operation: "inspect",
      ok: true,
      work: {
        workId: "work_runtime_ops_replay",
        status: "blocked",
        lastError: { code: "REPLAY_DIVERGED" },
      },
      flow: {
        flowId: "flow_runtime_ops_replay",
        fingerprint: ["step:old-label"],
      },
    });

    const retry = await runRuntimeOperation({
      root,
      operation: "retry",
      workId: "work_runtime_ops_replay",
    });
    expect(retry).toMatchObject({
      operation: "retry",
      ok: true,
      retried: true,
      work: {
        status: "pending",
        attempt: 1,
        idempotencyKey: expect.stringMatching(
          /^retry:work_runtime_ops_replay:/,
        ),
      },
      dispatch: { delivered: 1, failed: 0 },
    });

    const retriedWork = await runRuntimeOperation({
      root,
      operation: "inspect",
      workId: "work_runtime_ops_replay",
    });
    expect(retriedWork).toMatchObject({ operation: "inspect", ok: true });
    expect(retriedWork.operation).toBe("inspect");
    if (retriedWork.operation !== "inspect") {
      throw new Error(
        `Expected inspect operation, received ${retriedWork.operation}`,
      );
    }
    expect(retriedWork.work?.attempt).toBeGreaterThanOrEqual(1);
    expect(["pending", "blocked"]).toContain(retriedWork.work?.status);
    if (retriedWork.work?.status === "blocked") {
      expect(retriedWork.work.lastError).toMatchObject({
        code: "REPLAY_DIVERGED",
      });
    }

    await expect(
      runRuntimeOperation({
        root,
        operation: "cancel",
        workId: "work_runtime_ops_cancel",
      }),
    ).resolves.toMatchObject({
      operation: "cancel",
      ok: true,
      cancelled: true,
    });
  }, 30_000);

  it("reports exact status counts beyond the status detail page size", async () => {
    const schema = `crux_runtime_ops_counts_${Date.now()}`;
    schemas.push(schema);
    const root = await runtimeOpsFixtureRoot({ schema });

    await expect(
      runSetupOperation({ root, mode: "apply" }),
    ).resolves.toMatchObject({
      ok: true,
      setup: { mode: "apply", ok: true },
      generation: { status: "generated" },
    });

    const seedStore = postgres({
      url: database.url,
      schema,
      poolOptions: { allowExitOnIdle: true },
    });
    try {
      const now = new Date("2026-07-03T00:00:00.000Z");
      for (let index = 0; index < 1_005; index += 1) {
        await seedStore.state.createWork({
          workId: `work_runtime_ops_count_${index}` as WorkId,
          namespace: "local",
          work: {
            kind: "task.run",
            taskId: `task_runtime_ops_count_${index}` as TaskId,
            targetId: "runtime-ops-counted" as RuntimeTargetId,
            input: {},
          },
          targetId: "runtime-ops-counted" as RuntimeTargetId,
          idempotencyKey: `task:work_runtime_ops_count_${index}`,
          now,
        });
      }
    } finally {
      await seedStore.close();
    }

    await expect(
      runRuntimeOperation({ root, operation: "status" }),
    ).resolves.toMatchObject({
      operation: "status",
      ok: true,
      counts: expect.arrayContaining([
        expect.objectContaining({
          status: "pending",
          targetId: "runtime-ops-counted",
          count: 1_005,
        }),
      ]),
    });
  }, 30_000);

  it("reports a fallback namespace warning without failing runtime preflight", async () => {
    const schema = `crux_runtime_ops_namespace_${Date.now()}`;
    schemas.push(schema);
    const root = await runtimeOpsFixtureRoot({ schema, serverless: true });

    await runSetupOperation({ root, mode: "apply" });

    await expect(
      runRuntimeOperation({ root, operation: "preflight" }),
    ).resolves.toMatchObject({
      operation: "preflight",
      ok: true,
      setup: {
        ok: true,
        findings: [
          expect.objectContaining({
            code: "NAMESPACE_AMBIGUOUS",
            severity: "warning",
          }),
        ],
      },
      missingTargets: [],
    });
  }, 30_000);
});

async function runtimeOpsFixtureRoot(options: {
  readonly schema: string;
  readonly serverless?: boolean;
}): Promise<string> {
  const root = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".tmp-runtime-ops-"),
  );
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".crux/generated/runtime"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(
    join(root, "crux.config.ts"),
    [
      "import { config } from '@use-crux/core'",
      "import { genericQueue, node, serverless } from '@use-crux/core/runtime'",
      "import { postgres } from '@use-crux/postgres/runtime'",
      "import { Pool } from 'pg'",
      "",
      "const globalPools = globalThis as typeof globalThis & { __cruxRuntimeOpsPools?: Pool[] }",
      "globalPools.__cruxRuntimeOpsPools ??= []",
      `const pool = new Pool({ connectionString: ${JSON.stringify(database.url)}, allowExitOnIdle: true })`,
      "pool.on('error', () => undefined)",
      "globalPools.__cruxRuntimeOpsPools.push(pool)",
      "",
      "export default config({",
      options.serverless
        ? `  runtime: serverless({ store: postgres({ pool, schema: ${JSON.stringify(options.schema)} }), publicUrl: "https://app.example.com", env: {}, wake: genericQueue({ enqueue: async () => undefined }) }),`
        : `  runtime: node({ store: postgres({ pool, schema: ${JSON.stringify(options.schema)} }) }),`,
      "})",
    ].join("\n"),
  );
  await writeFile(
    join(root, "src/runtime-targets.ts"),
    [
      "import { flow } from '@use-crux/core/flow'",
      "",
      "export const reviewFlow = flow('runtime-ops-review', async (flow) => {",
      "  await flow.step('new-label', () => 'ok')",
      "  await flow.suspend('approval')",
      "})",
    ].join("\n"),
  );
  await writeFile(
    join(root, ".crux/generated/runtime/manifest.json"),
    `${JSON.stringify(
      {
        version: 3,
        evalPrivacyFingerprint:
          "d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29",
        targets: [
          {
            name: "runtime-ops-review",
            kind: "flow",
            module: "./src/runtime-targets.ts",
            export: "reviewFlow",
          },
        ],
        effectTargets: [],
        evals: [],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

async function seedReplayDivergedWork(
  store: PostgresRuntimeStore,
): Promise<void> {
  const now = new Date("2026-07-03T00:00:00.000Z");
  const work = await store.state.createWork({
    workId: "work_runtime_ops_replay" as WorkId,
    namespace: "local",
    work: { kind: "flow.resume", flowId: "flow_runtime_ops_replay" as FlowId },
    targetId: "runtime-ops-review" as RuntimeTargetId,
    idempotencyKey: "start:work_runtime_ops_replay",
    now,
  });
  await store.state.putSnapshot({
    flowId: "flow_runtime_ops_replay" as FlowId,
    workId: "work_runtime_ops_replay" as WorkId,
    targetId: "runtime-ops-review" as RuntimeTargetId,
    namespace: "local",
    status: "suspended",
    input: {},
    completedSteps: {},
    fingerprint: ["step:old-label"],
    pendingSuspends: [],
    scheduledWork: {},
    updatedAt: now,
  });
  await store.state.putWork(
    transition(work, {
      status: "blocked",
      lastError: {
        code: "REPLAY_DIVERGED",
        message: "previous replay drift",
        at: now,
      },
    }),
  );
}

async function seedCancellableWork(store: PostgresRuntimeStore): Promise<void> {
  await store.state.createWork({
    workId: "work_runtime_ops_cancel" as WorkId,
    namespace: "local",
    work: {
      kind: "task.run",
      taskId: "task_runtime_ops_cancel" as TaskId,
      targetId: "runtime-ops-cancel" as RuntimeTargetId,
      input: {},
    },
    targetId: "runtime-ops-cancel" as RuntimeTargetId,
    idempotencyKey: "task:work_runtime_ops_cancel",
    now: new Date("2026-07-03T00:00:00.000Z"),
  });
}

async function seedTimerAndOutbox(store: PostgresRuntimeStore): Promise<void> {
  const pendingAt = new Date("2999-07-04T00:00:00.000Z");
  await store.timers.put({
    namespace: "local",
    fireAt: pendingAt,
    work: {
      kind: "task.run",
      taskId: "task_runtime_ops_timer" as TaskId,
      targetId: "runtime-ops-timer" as RuntimeTargetId,
      input: {},
    },
  });
  await store.outbox.put(
    {
      v: 1,
      ns: "local",
      workId: "work_runtime_ops_cancel" as WorkId,
      target: "runtime-ops-cancel" as RuntimeTargetId,
      kind: "task.run",
      idempotencyKey: "task:work_runtime_ops_cancel",
      attempt: 1,
    },
    { deliverAt: pendingAt },
  );
}
