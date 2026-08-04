import { createHash } from "node:crypto";
import {
  canonicalRuntimeResult,
  RUNTIME_RESULT_MEDIA_TYPE,
  type RuntimeResultPayloadPort,
  type RuntimeResultRef,
} from "@use-crux/core/runtime";
import type { JsonValue } from "@use-crux/core";
import { prunePostgresRows } from "./prune";
import type { PgExecutor } from "./sql";
import { table } from "./sql";

/** Create PostgreSQL-backed canonical content-addressed Runtime result storage. */
export function createPostgresResultPayloadPort(
  db: PgExecutor,
  schema: string,
): RuntimeResultPayloadPort {
  const results = table(schema, "results");
  const work = table(schema, "work");
  const sessionInputs = table(schema, "session_inputs");

  return {
    async put(payload, options): Promise<RuntimeResultRef> {
      const canonical = canonicalRuntimeResult(payload);
      const namespaceHash = createHash("sha256")
        .update(options.namespace)
        .digest("hex");
      const location = `postgres:${namespaceHash}:sha256:${canonical.sha256}`;
      await db.query(
        `INSERT INTO ${results}
          (location, namespace, sha256, size, media_type, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
         ON CONFLICT (location) DO NOTHING`,
        [
          location,
          options.namespace,
          canonical.sha256,
          canonical.bytes.byteLength,
          RUNTIME_RESULT_MEDIA_TYPE,
          canonical.json,
        ],
      );
      return Object.freeze({
        sha256: canonical.sha256,
        size: canonical.bytes.byteLength,
        mediaType: RUNTIME_RESULT_MEDIA_TYPE,
        location,
      });
    },

    async get(ref): Promise<JsonValue | null> {
      const result = await db.query<{ readonly payload: JsonValue }>(
        `SELECT payload FROM ${results} WHERE location = $1`,
        [ref.location],
      );
      const payload = result.rows[0]?.payload;
      if (payload === undefined) return null;
      const canonical = canonicalRuntimeResult(payload);
      if (
        ref.mediaType !== RUNTIME_RESULT_MEDIA_TYPE ||
        ref.sha256 !== canonical.sha256 ||
        ref.size !== canonical.bytes.byteLength
      ) {
        throw new TypeError(
          "Runtime result payload failed content-integrity verification.",
        );
      }
      return JSON.parse(canonical.json) as JsonValue;
    },

    async delete(ref): Promise<void> {
      await db.query(`DELETE FROM ${results} WHERE location = $1`, [
        ref.location,
      ]);
    },

    async pruneUnreferenced(options) {
      return await prunePostgresRows(db, {
        table: results,
        filters: [
          "namespace = $2",
          "created_at < $1",
          `NOT EXISTS (
             SELECT 1 FROM ${work}
              WHERE work.result_ref ->> 'location' = ${results}.location
           )`,
          `NOT EXISTS (
             SELECT 1 FROM ${sessionInputs}
              WHERE prepared_execution -> 'preparedResultRef' ->> 'location' = ${results}.location
           )`,
        ],
        values: [options.before, options.namespace],
        orderBy: "created_at ASC, location ASC",
        limit: options.limit,
      });
    },
  };
}
