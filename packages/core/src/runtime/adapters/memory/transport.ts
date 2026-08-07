/**
 * In-memory managed-transport envelope store.
 *
 * @module
 */

import type { StatisticsLedgerExport } from "../../../statistics";
import type {
  AcceptRuntimeTransportEnvelopeInput,
  AcceptRuntimeTransportEnvelopeResult,
  ClaimRuntimeTransportEnvelopesOptions,
  CompleteRuntimeTransportNormalizationInput,
  FailRuntimeTransportNormalizationInput,
  ReplayRuntimeTransportEnvelopeInput,
  RuntimeTransportStorePort,
} from "../../transport/store";
import type {
  RuntimeTransportEnvelopeIdentity,
  RuntimeTransportEnvelopeRecord,
} from "../../transport/records";
import type { RuntimeTransportBindingCheckpoint } from "../../transport/binding-checkpoint";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import {
  matchesPruneNamespace,
  olderThan,
  pruneMapValues,
} from "./retention";

export function createMemoryTransportStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeTransportStorePort {
  return {
    async get(identity) {
      const record = data.transportEnvelopes.get(identityKey(identity));
      return record ? cloneRecord(record) : null;
    },

    async accept(
      input: AcceptRuntimeTransportEnvelopeInput,
    ): Promise<AcceptRuntimeTransportEnvelopeResult> {
      const identity = {
        namespace: input.namespace,
        provider: input.envelope.provider,
        accountId: input.envelope.accountId,
        eventId: input.envelope.eventId,
      };
      const key = identityKey(identity);
      const existing = data.transportEnvelopes.get(key);

      if (existing) {
        if (existing.envelopeDigest !== input.envelopeDigest) {
          return Object.freeze({
            kind: "conflict" as const,
            record: cloneRecord(existing),
          });
        }

        return Object.freeze({
          kind: "duplicate" as const,
          record: cloneRecord(existing),
        });
      }

      recordWrite?.();
      const now = input.now.toISOString();
      const record: RuntimeTransportEnvelopeRecord = Object.freeze({
        schemaVersion: 1,
        namespace: input.namespace,
        provider: input.envelope.provider,
        accountId: input.envelope.accountId,
        eventId: input.envelope.eventId,
        bindingId: input.envelope.bindingId,
        envelope: input.envelope,
        envelopeDigest: input.envelopeDigest,
        state: "accepted",
        attempts: 0,
        maxAttempts: input.maxAttempts,
        acceptedAt: now,
        updatedAt: now,
        nextAttemptAt: now,
      });

      data.transportEnvelopes.set(key, record);

      return Object.freeze({
        kind: "accepted" as const,
        record: cloneRecord(record),
      });
    },

    async claim(options: ClaimRuntimeTransportEnvelopesOptions) {
      const nowMs = options.now.getTime();
      const nowIso = options.now.toISOString();
      const leaseExpiresAt = new Date(nowMs + options.leaseMs).toISOString();
      const eligible = [...data.transportEnvelopes.values()]
        .filter(
          (record) =>
            record.namespace === options.namespace &&
            isClaimable(record, nowMs),
        )
        .sort((left, right) =>
          left.nextAttemptAt < right.nextAttemptAt
            ? -1
            : left.nextAttemptAt > right.nextAttemptAt
              ? 1
              : compareIdentity(left, right),
        )
        .slice(0, options.limit);

      const claimed: RuntimeTransportEnvelopeRecord[] = [];
      for (const record of eligible) {
        recordWrite?.();
        const next: RuntimeTransportEnvelopeRecord = Object.freeze({
          ...record,
          state: "claimed",
          attempts: record.attempts + 1,
          updatedAt: nowIso,
          nextAttemptAt: leaseExpiresAt,
          leaseToken: options.leaseToken,
          leaseExpiresAt,
          lastFailure: record.lastFailure,
          lineage: record.lineage,
        });
        data.transportEnvelopes.set(identityKey(next), next);
        claimed.push(cloneRecord(next));
      }
      return Object.freeze(claimed);
    },

    async completeNormalization(
      input: CompleteRuntimeTransportNormalizationInput,
    ) {
      const key = identityKey(input.identity);
      const existing = data.transportEnvelopes.get(key);

      if (!existing) {
        return null;
      }

      if (existing.state === "normalized") {
        return cloneRecord(existing);
      }

      if (
        existing.state !== "claimed" ||
        existing.leaseToken !== input.leaseToken
      ) {
        return null;
      }

      recordWrite?.();
      const next: RuntimeTransportEnvelopeRecord = Object.freeze({
        schemaVersion: existing.schemaVersion,
        namespace: existing.namespace,
        provider: existing.provider,
        accountId: existing.accountId,
        eventId: existing.eventId,
        bindingId: existing.bindingId,
        envelope: existing.envelope,
        envelopeDigest: existing.envelopeDigest,
        state: "normalized",
        attempts: existing.attempts,
        maxAttempts: existing.maxAttempts,
        acceptedAt: existing.acceptedAt,
        updatedAt: input.now.toISOString(),
        nextAttemptAt: input.now.toISOString(),
        ...(input.lineage
          ? {
              lineage: Object.freeze(
                input.lineage.map((entry) => Object.freeze({ ...entry })),
              ),
            }
          : {}),
        ...(input.lineageTruncated === true
          ? { lineageTruncated: true as const }
          : {}),
      });

      data.transportEnvelopes.set(key, next);

      return cloneRecord(next);
    },

    async failNormalization(input: FailRuntimeTransportNormalizationInput) {
      const key = identityKey(input.identity);
      const existing = data.transportEnvelopes.get(key);

      if (
        !existing ||
        existing.state !== "claimed" ||
        existing.leaseToken !== input.leaseToken
      ) {
        return null;
      }

      recordWrite?.();
      const deadLetter = existing.attempts >= existing.maxAttempts;
      const next: RuntimeTransportEnvelopeRecord = Object.freeze({
        schemaVersion: existing.schemaVersion,
        namespace: existing.namespace,
        provider: existing.provider,
        accountId: existing.accountId,
        eventId: existing.eventId,
        bindingId: existing.bindingId,
        envelope: existing.envelope,
        envelopeDigest: existing.envelopeDigest,
        state: deadLetter ? "dead-letter" : "accepted",
        attempts: existing.attempts,
        maxAttempts: existing.maxAttempts,
        acceptedAt: existing.acceptedAt,
        updatedAt: input.now.toISOString(),
        nextAttemptAt: deadLetter
          ? input.now.toISOString()
          : input.nextAttemptAt.toISOString(),
        lastFailure: Object.freeze({
          message: input.message,
          ...(input.code === undefined ? {} : { code: input.code }),
        }),
        lineage: existing.lineage,
      });

      data.transportEnvelopes.set(key, next);

      return cloneRecord(next);
    },

    async replay(input: ReplayRuntimeTransportEnvelopeInput) {
      const key = identityKey(input.identity);
      const existing = data.transportEnvelopes.get(key);

      if (!existing || existing.state !== "dead-letter") {
        return null;
      }

      recordWrite?.();
      const next: RuntimeTransportEnvelopeRecord = Object.freeze({
        schemaVersion: existing.schemaVersion,
        namespace: existing.namespace,
        provider: existing.provider,
        accountId: existing.accountId,
        eventId: existing.eventId,
        bindingId: existing.bindingId,
        envelope: existing.envelope,
        envelopeDigest: existing.envelopeDigest,
        state: "accepted",
        attempts: 0,
        maxAttempts: existing.maxAttempts,
        acceptedAt: existing.acceptedAt,
        updatedAt: input.now.toISOString(),
        nextAttemptAt: input.now.toISOString(),
        lastFailure: existing.lastFailure,
      });

      data.transportEnvelopes.set(key, next);

      return cloneRecord(next);
    },

    async getStatistics(namespace: string) {
      const value = data.transportStatistics.get(namespace);

      if (!value) {
        return null;
      }

      return cloneStatistics(value);
    },

    async putStatistics(namespace: string, statistics: StatisticsLedgerExport) {
      recordWrite?.();
      data.transportStatistics.set(namespace, cloneStatistics(statistics));
    },

    async prune(options) {
      const result = pruneMapValues(
        data.transportEnvelopes,
        options,
        (record) =>
          matchesPruneNamespace(record, options.namespace) &&
          (record.state === "normalized" || record.state === "dead-letter") &&
          olderThan(new Date(record.updatedAt), options.before),
        () => {
          recordWrite?.();
        },
      );
      return result;
    },

    async getBindingCheckpoint(identity) {
      const record = data.transportBindingCheckpoints.get(
        bindingCheckpointKey(identity.namespace, identity.bindingId),
      );
      return record ? cloneBindingCheckpoint(record) : null;
    },

    async putBindingCheckpoint(checkpoint) {
      recordWrite?.();
      data.transportBindingCheckpoints.set(
        bindingCheckpointKey(checkpoint.namespace, checkpoint.bindingId),
        cloneBindingCheckpoint(checkpoint),
      );
    },
  };
}

function bindingCheckpointKey(namespace: string, bindingId: string): string {
  return scopedKey(namespace, bindingId);
}

function cloneBindingCheckpoint(
  checkpoint: RuntimeTransportBindingCheckpoint,
): RuntimeTransportBindingCheckpoint {
  return Object.freeze({
    schemaVersion: 1 as const,
    namespace: checkpoint.namespace,
    bindingId: checkpoint.bindingId,
    cursor: checkpoint.cursor,
    updatedAt: checkpoint.updatedAt,
    ...(checkpoint.lastPolledAt !== undefined
      ? { lastPolledAt: checkpoint.lastPolledAt }
      : {}),
    ...(checkpoint.lastOwnerId !== undefined
      ? { lastOwnerId: checkpoint.lastOwnerId }
      : {}),
    ...(checkpoint.lastErrorCode !== undefined
      ? { lastErrorCode: checkpoint.lastErrorCode }
      : {}),
    ...(checkpoint.morePending === true ? { morePending: true as const } : {}),
  });
}

function isClaimable(
  record: RuntimeTransportEnvelopeRecord,
  nowMs: number,
): boolean {
  if (record.state === "accepted") {
    return Date.parse(record.nextAttemptAt) <= nowMs;
  }

  if (record.state === "claimed" && record.leaseExpiresAt) {
    return Date.parse(record.leaseExpiresAt) <= nowMs;
  }

  return false;
}

function identityKey(identity: RuntimeTransportEnvelopeIdentity): string {
  return scopedKey(
    identity.namespace,
    `${identity.provider}\0${identity.accountId}\0${identity.eventId}`,
  );
}

function compareIdentity(
  left: RuntimeTransportEnvelopeRecord,
  right: RuntimeTransportEnvelopeRecord,
): number {
  const leftKey = `${left.provider}\0${left.accountId}\0${left.eventId}`;
  const rightKey = `${right.provider}\0${right.accountId}\0${right.eventId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function cloneRecord(
  record: RuntimeTransportEnvelopeRecord,
): RuntimeTransportEnvelopeRecord {
  return Object.freeze({
    ...record,
    envelope: record.envelope,
    lastFailure: record.lastFailure
      ? Object.freeze({ ...record.lastFailure })
      : undefined,
    lineage: record.lineage
      ? Object.freeze(record.lineage.map((entry) => Object.freeze({ ...entry })))
      : undefined,
    ...(record.lineageTruncated === true
      ? { lineageTruncated: true as const }
      : {}),
  });
}

function cloneStatistics(
  value: StatisticsLedgerExport,
): StatisticsLedgerExport {
  return Object.freeze({
    version: value.version,
    owner: Object.freeze({ ...value.owner }),
    cursor: value.cursor,
    state: value.state,
  });
}
