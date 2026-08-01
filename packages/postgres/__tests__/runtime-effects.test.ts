import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  FlowId,
  FlowSnapshot,
  RuntimeTargetId,
  WorkId,
} from "@use-crux/core/runtime";
import { postgres } from "../src/runtime";
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from "./test-database";

describe("Postgres Runtime Flow Effects snapshots", () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await database?.close();
  });

  it("round-trips an optional Effect scope reference", async () => {
    const pool = createPostgresTestPool(database.url);
    const store = postgres({ pool, schema: "crux_runtime_effects" });

    try {
      await store.setup.apply();
      const snapshot: FlowSnapshot = {
        flowId: "flow_effects" as FlowId,
        workId: "work_effects" as WorkId,
        targetId: "review" as RuntimeTargetId,
        namespace: "tenant-a",
        status: "suspended",
        effects: {
          kind: "effect.scope",
          id: "effect-boundary:1",
          runId: "flow_effects",
        },
        input: {},
        completedSteps: {},
        fingerprint: [],
        pendingSuspends: [],
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      };

      await store.state.putSnapshot(snapshot);

      await expect(
        store.state.getSnapshot(snapshot.flowId, {
          namespace: snapshot.namespace,
        }),
      ).resolves.toMatchObject({ effects: snapshot.effects });
    } finally {
      await store.close();
      await pool.end();
    }
  });

  it("additively migrates snapshots missing Effects and continuation", async () => {
    const pool = createPostgresTestPool(database.url);
    const schema = `crux_runtime_effects_migration_${Date.now()}`;
    const store = postgres({ pool, schema });

    try {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await pool.query(`CREATE TABLE "${schema}".snapshots (
        namespace text NOT NULL,
        flow_id text NOT NULL,
        work_id text NOT NULL,
        target_id text NOT NULL,
        status text NOT NULL,
        input jsonb NOT NULL,
        completed_steps jsonb NOT NULL,
        fingerprint jsonb NOT NULL,
        pending_suspends jsonb NOT NULL,
        delivered_suspends jsonb,
        scheduled_work jsonb,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (namespace, flow_id)
      )`);

      const legacyFlowId = "flow_legacy_effects" as FlowId;
      await pool.query(
        `INSERT INTO "${schema}".snapshots (
          namespace, flow_id, work_id, target_id, status, input,
          completed_steps, fingerprint, pending_suspends, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          "tenant-a",
          legacyFlowId,
          "work_legacy_effects",
          "review",
          "suspended",
          JSON.stringify({ source: "legacy" }),
          JSON.stringify({}),
          JSON.stringify([]),
          JSON.stringify([]),
          new Date("2026-07-31T23:59:00.000Z"),
        ],
      );

      await store.setup.apply();
      const legacySnapshot = await store.state.getSnapshot(legacyFlowId, {
        namespace: "tenant-a",
      });
      expect(legacySnapshot).toMatchObject({
        flowId: legacyFlowId,
        namespace: "tenant-a",
        input: { source: "legacy" },
      });
      expect(legacySnapshot?.effects).toBeUndefined();
      expect(legacySnapshot?.continuation).toBeUndefined();

      const snapshot: FlowSnapshot = {
        flowId: "flow_migrated_effects" as FlowId,
        workId: "work_migrated_effects" as WorkId,
        targetId: "review" as RuntimeTargetId,
        namespace: "tenant-a",
        status: "suspended",
        effects: {
          kind: "effect.scope",
          id: "effect-boundary:migrated",
          runId: "flow_migrated_effects",
        },
        input: {},
        continuation: { traceparent: "migrated" },
        completedSteps: {},
        fingerprint: [],
        pendingSuspends: [],
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      };
      await store.state.putSnapshot(snapshot);

      await expect(
        store.state.getSnapshot(snapshot.flowId, {
          namespace: snapshot.namespace,
        }),
      ).resolves.toMatchObject({
        effects: snapshot.effects,
        continuation: snapshot.continuation,
      });
    } finally {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
});
