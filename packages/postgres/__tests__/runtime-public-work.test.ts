import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  node,
  type WorkId,
} from "@use-crux/core/runtime";
import { WorkResultExpiredError } from "@use-crux/core/work";
import { postgres } from "../src/runtime";
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from "./test-database";
import { startWorker } from "./runtime-worker-restart-fixture";

describe("PostgreSQL public Work retention", () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it("reconnects public Flow Work to its exact result after a worker restart", async () => {
    const schema = `crux_runtime_public_work_result_${Date.now()}`;
    const namespace = "public-work-result";
    const firstPool = createPostgresTestPool(database.url);
    const replacementPool = createPostgresTestPool(database.url);
    const firstStore = postgres({ pool: firstPool, schema });
    const replacementStore = postgres({ pool: replacementPool, schema });
    const executions: string[] = [];
    const review = flow(
      "public-work-review",
      async (
        _scope,
        input: {
          readonly documentId: string;
        },
      ) => {
        executions.push(input.documentId);
        return { documentId: input.documentId, approved: true as const };
      },
    );
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    let worker: ReturnType<typeof startWorker> | undefined;
    let reconnectedHost: ReturnType<typeof createWorkHost> | undefined;

    try {
      await firstStore.setup.apply();
      const firstHost = createWorkHost({
        runtime: node({
          store: firstStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const accepted = await firstHost.run(() =>
        spawn(review, { documentId: "doc_1" }, { idempotencyKey: "request_1" }),
      );
      expect(executions).toEqual([]);
      await expect(accepted.status()).resolves.toMatchObject({
        state: "queued",
      });
      const workId = accepted.id as WorkId;
      const [wake] = await firstStore.outbox.listByWork(workId, {
        namespace,
      });
      if (!wake) throw new Error("Expected accepted Work wake.");
      firstHost.dispose();

      const resultPut = vi.spyOn(replacementStore.results, "put");
      worker = startWorker(replacementStore, namespace, program);
      reconnectedHost = createWorkHost({
        runtime: node({
          store: replacementStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const reconnected = await reconnectedHost.run(() =>
        getWork(review, accepted.id),
      );
      await expect
        .poll(
          async () =>
            await replacementStore.state.getWork(workId, { namespace }),
        )
        .toMatchObject({ status: "completed", resultRef: expect.anything() });
      await expect(reconnected.result()).resolves.toEqual({
        documentId: "doc_1",
        approved: true,
      });
      await expect(
        worker.runtime.kernel.handleWake(wake.envelope),
      ).resolves.toMatchObject({
        outcome: "duplicate",
      });
      await expect(
        worker.runtime.kernel.handleWake(wake.envelope),
      ).resolves.toMatchObject({
        outcome: "duplicate",
      });
      expect(executions).toEqual(["doc_1"]);
      expect(resultPut).toHaveBeenCalledOnce();
    } finally {
      reconnectedHost?.dispose();
      await worker?.stop();
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

  it("retains referenced results and expires removed payloads without re-executing", async () => {
    const schema = `crux_runtime_public_work_${Date.now()}`;
    const namespace = "public-work-retention";
    const firstPool = createPostgresTestPool(database.url);
    const replacementPool = createPostgresTestPool(database.url);
    const firstStore = postgres({ pool: firstPool, schema });
    const replacementStore = postgres({ pool: replacementPool, schema });
    const executions: string[] = [];
    const review = flow(
      "public-work-retention-review",
      async (
        _scope,
        input: {
          readonly documentId: string;
        },
      ) => {
        executions.push(input.documentId);
        return { documentId: input.documentId, approved: true as const };
      },
    );
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    let worker: ReturnType<typeof startWorker> | undefined;
    let reconnectedHost: ReturnType<typeof createWorkHost> | undefined;

    try {
      await firstStore.setup.apply();
      const firstHost = createWorkHost({
        runtime: node({
          store: firstStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const accepted = await firstHost.run(() =>
        spawn(review, { documentId: "doc_1" }, { idempotencyKey: "request_1" }),
      );
      const workId = accepted.id as WorkId;
      const [wake] = await firstStore.outbox.listByWork(workId, {
        namespace,
      });
      if (!wake) throw new Error("Expected accepted Work wake.");
      firstHost.dispose();

      worker = startWorker(replacementStore, namespace, program);
      reconnectedHost = createWorkHost({
        runtime: node({
          store: replacementStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const reconnected = await reconnectedHost.run(() =>
        getWork(review, accepted.id),
      );
      await expect(reconnected.result()).resolves.toEqual({
        documentId: "doc_1",
        approved: true,
      });
      const completed = await replacementStore.state.getWork(workId, {
        namespace,
      });
      const ref = completed?.resultRef;
      if (!ref) throw new Error("Expected completed Work result reference.");

      await expect(
        replacementStore.results.pruneUnreferenced({
          namespace,
          before: new Date(Date.now() + 60_000),
          limit: 10,
        }),
      ).resolves.toEqual({ removed: 0, truncated: false });
      await expect(replacementStore.results.get(ref)).resolves.toEqual({
        documentId: "doc_1",
        approved: true,
      });

      const orphan = await replacementStore.results.put(
        { documentId: "orphan" },
        { namespace },
      );
      await expect(
        replacementStore.results.pruneUnreferenced({
          namespace,
          before: new Date(Date.now() + 60_000),
          limit: 10,
        }),
      ).resolves.toEqual({ removed: 1, truncated: false });
      await expect(replacementStore.results.get(orphan)).resolves.toBeNull();

      await replacementPool.query(
        `UPDATE "${schema}"."results" SET payload = '{"tampered":true}'::jsonb WHERE location = $1`,
        [ref.location],
      );
      await expect(replacementStore.results.get(ref)).rejects.toThrow(
        "content-integrity verification",
      );

      const beforeExpiry = await replacementStore.outbox.listByWork(workId, {
        namespace,
      });
      await replacementStore.results.delete(ref);
      await expect(reconnected.result()).rejects.toBeInstanceOf(
        WorkResultExpiredError,
      );
      await expect(
        worker.runtime.kernel.handleWake(wake.envelope),
      ).resolves.toMatchObject({
        outcome: "duplicate",
      });
      await expect(
        replacementStore.outbox.listByWork(workId, { namespace }),
      ).resolves.toEqual([
        expect.objectContaining({
          outboxId: beforeExpiry[0]?.outboxId,
          state: "confirmed",
        }),
      ]);
      expect(executions).toEqual(["doc_1"]);
    } finally {
      reconnectedHost?.dispose();
      await worker?.stop();
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
