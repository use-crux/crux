import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import { createRuntimeProgram, node } from "@use-crux/core/runtime";
import { postgres } from "../src/runtime";
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from "./test-database";

describe("PostgreSQL public Work control persistence", () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it("reconstructs progress, ownership, statistics, streams, and cancellation", async () => {
    const schema = `crux_runtime_public_work_control_${Date.now()}`;
    const namespace = "public-work-control";
    const firstPool = createPostgresTestPool(database.url);
    const replacementPool = createPostgresTestPool(database.url);
    const firstStore = postgres({ pool: firstPool, schema });
    const replacementStore = postgres({ pool: replacementPool, schema });
    const review = flow("public-work-control-review", async () => "done");
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    let firstHost: ReturnType<typeof createWorkHost> | undefined;
    let replacementHost: ReturnType<typeof createWorkHost> | undefined;

    try {
      await firstStore.setup.apply();
      firstHost = createWorkHost({
        runtime: node({
          store: firstStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const accepted = await firstHost.run(() =>
        spawn(review, { idempotencyKey: "request_1" }),
      );
      await accepted.progress({ message: "Persisted", current: 1, total: 2 });
      await accepted.detach();
      const beforeRestart = await accepted.stats();
      firstHost.dispose();
      firstHost = undefined;

      replacementHost = createWorkHost({
        runtime: node({
          store: replacementStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const reconnected = await replacementHost.run(() =>
        getWork(review, accepted.id),
      );
      await expect(reconnected.status()).resolves.toMatchObject({
        state: "queued",
        progress: { message: "Persisted", current: 1, total: 2 },
        ownership: { state: "detached", reason: "explicit" },
      });
      await expect(reconnected.stats()).resolves.toEqual(beforeRestart);

      const iterator = reconnected.stream()[Symbol.asyncIterator]();
      await iterator.next();
      const terminal = iterator.next();
      await reconnected.cancel({ reason: "No longer needed" });
      await expect(terminal).resolves.toMatchObject({
        value: { status: { state: "cancelled", reason: "No longer needed" } },
      });
      await expect(iterator.next()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      firstHost?.dispose();
      replacementHost?.dispose();
      await Promise.all([firstStore.close(), replacementStore.close()]);
      await Promise.all([firstPool.end(), replacementPool.end()]);
      const cleanup = createPostgresTestPool(database.url);
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  });
});
