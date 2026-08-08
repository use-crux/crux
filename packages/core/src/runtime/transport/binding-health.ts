/**
 * Bounded, secret-free managed-transport binding health read model.
 *
 * @remarks Derives operator-visible health from the immutable Runtime program,
 * durable binding checkpoints, and the existing transport statistics ledger.
 * Does not introduce a second store, worker, registry, or high-cardinality
 * event map. Live reconnect backoff, live lease tokens, and shutdown outcomes
 * that are not durable are reported with explicit coverage — never fabricated.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import {
  isManagedStreamTransport,
  isPollingTransport,
  isSseTransport,
  isWebSocketTransport,
  isWebhookTransport,
} from "../../signal/provider";
import type { TransportEnvelopeOutcomeStats } from "../../statistics";
import type { RuntimeProgram } from "../program";
import { resolveProgramProvider } from "../program-providers";
import type { RuntimeStoreAdapter } from "../store";
import type {
  RuntimeManagedTransportBinding,
  RuntimeTransportConfigRef,
  RuntimeSignalTransportTarget,
} from "./contracts";
import type {
  RuntimeTransportBindingCheckpoint,
  RuntimeTransportBindingStatus,
} from "./binding-checkpoint";
import { TransportStoreMissingError } from "./lifecycle-errors";
import {
  emptyTransportEnvelopeStats,
  transportStatisticsFromExport,
  transportStatisticsIdentity,
} from "./statistics";

/** Maximum binding identities projected in one health snapshot. */
export const MAX_TRANSPORT_BINDING_HEALTH = 64;

/**
 * Provider transport kind known from executable program authority.
 *
 * @remarks `"unknown"` when no matching provider is available to classify the
 * binding. Never invents a kind for inert declarations alone.
 */
export type RuntimeTransportKind =
  | "webhook"
  | "polling"
  | "stream"
  | "sse"
  | "websocket"
  | "unknown";

/**
 * Availability of one health facet.
 *
 * - `available` / `durable` — backed by durable evidence.
 * - `defaulted` — field has a documented default (for example active status).
 * - `absent` — durable slot exists but holds no value yet.
 * - `missing` — stats identity not attributed in the first-64 map.
 * - `other` — identity rolled into `otherIdentities` past the bound.
 * - `unavailable` — not knowable from durable Runtime storage.
 * - `unsupported` — adapter/port does not implement the capability.
 */
export type RuntimeTransportHealthCoverage =
  | "available"
  | "durable"
  | "defaulted"
  | "absent"
  | "missing"
  | "other"
  | "unavailable"
  | "unsupported";

/**
 * Privacy-safe outcome counters for one binding when attribution evidence exists.
 *
 * @remarks Field names match the statistics ledger (`deduplicated`, not a
 * parallel “duplicated” vocabulary). Counts appear only when coverage is
 * `available` or `other`.
 */
export interface RuntimeTransportBindingHealthOutcomes {
  readonly coverage: "available" | "other" | "missing" | "unavailable";
  readonly accepted?: number;
  readonly deduplicated?: number;
  readonly normalized?: number;
  readonly delivered?: number;
  readonly retried?: number;
  readonly deadLettered?: number;
}

/**
 * One restart-safe binding health row for operators and Devtools.
 *
 * @remarks Omits raw cursors, payloads, credentials, lease tokens, and unbounded
 * event identities. Cursor age is derived from checkpoint `updatedAt` when a
 * cursor is present; provider lag is not durable and stays unavailable.
 */
export interface RuntimeTransportBindingHealth {
  readonly schema: 1;
  readonly namespace: string;
  readonly bindingId: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly configRef: RuntimeTransportConfigRef;
  readonly target: RuntimeSignalTransportTarget;
  readonly transportKind: RuntimeTransportKind;
  readonly transportKindCoverage: "available" | "unavailable";
  readonly status: RuntimeTransportBindingStatus;
  readonly statusCoverage:
    | "durable"
    | "defaulted"
    | "unavailable"
    | "unsupported"
    | "missing_port";
  readonly lease: {
    readonly coverage:
      | "last_owner"
      | "absent"
      | "unavailable"
      | "unsupported"
      | "missing_port";
    readonly ownerId?: string;
  };
  readonly cursor: {
    readonly present: boolean;
    readonly coverage:
      | "durable"
      | "absent"
      | "unavailable"
      | "unsupported"
      | "missing_port";
    readonly ageMs?: number;
    readonly updatedAt?: string;
    readonly lastAcquiredAt?: string;
    readonly lagCoverage: "unavailable";
  };
  readonly outcomes: RuntimeTransportBindingHealthOutcomes;
  readonly fault: {
    readonly coverage: "durable" | "absent";
    readonly lastErrorCode?: string;
  };
  readonly reconnect: {
    readonly coverage: "unavailable" | "durable_exhausted";
  };
  readonly shutdown: {
    readonly coverage: "unavailable";
  };
  readonly morePending?: boolean;
  readonly checkpointUpdatedAt?: string;
}

/**
 * Bounded namespace health snapshot for every program transport binding.
 *
 * @remarks At most {@link MAX_TRANSPORT_BINDING_HEALTH} bindings are projected.
 * Exact envelope totals come from the owner-scoped statistics ledger.
 */
export interface RuntimeTransportBindingHealthSnapshot {
  readonly schema: 1;
  readonly namespace: string;
  readonly observedAt: string;
  readonly bindings: readonly RuntimeTransportBindingHealth[];
  readonly totals: TransportEnvelopeOutcomeStats;
  readonly coverage: {
    readonly bindingLimit: typeof MAX_TRANSPORT_BINDING_HEALTH;
    readonly bindings: "complete" | "truncated";
    readonly identityAttribution: "complete" | "truncated";
    readonly checkpoints: "available" | "unsupported" | "missing_port";
    readonly statistics: "available" | "missing" | "missing_port";
  };
}

/** Options for {@link transportBindingHealth}. */
export interface TransportBindingHealthOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  /**
   * Immutable program providing inert bindings and optional executable providers.
   *
   * @remarks When omitted, pass {@link bindings} (and optionally `providers`)
   * explicitly. Prefer a program so transport kind resolves from authority.
   */
  readonly program?: Pick<RuntimeProgram, "transports" | "providers">;
  /** Explicit bindings when no program is supplied. */
  readonly bindings?: readonly RuntimeManagedTransportBinding[];
  /** Executable providers used only to classify transport kind. */
  readonly providers?: readonly SignalProvider[];
  /** Observation clock for cursor age. Defaults to `new Date()`. */
  readonly now?: Date;
}

/** Options for pure {@link projectTransportBindingHealth}. */
export interface ProjectTransportBindingHealthOptions {
  readonly namespace: string;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider?: SignalProvider;
  readonly checkpoint?: RuntimeTransportBindingCheckpoint | null;
  readonly checkpointCoverage?: "available" | "unsupported" | "missing_port";
  readonly outcomes?: TransportEnvelopeOutcomeStats | null;
  readonly outcomesCoverage: RuntimeTransportBindingHealthOutcomes["coverage"];
  readonly now: Date;
}

/**
 * Load one bounded, secret-free binding health snapshot from durable Runtime state.
 *
 * @param options - Store, namespace, program/bindings, and observation clock.
 * @returns Frozen snapshot with explicit coverage for unavailable facets.
 * @throws {@link TransportStoreMissingError} when the store has no transports port.
 */
export async function transportBindingHealth(
  options: TransportBindingHealthOptions,
): Promise<RuntimeTransportBindingHealthSnapshot> {
  const now = options.now ?? new Date();
  const bindings = resolveBindings(options);
  const providers = options.program?.providers ?? options.providers ?? [];

  if (!options.store.transports) {
    throw new TransportStoreMissingError();
  }

  const checkpointPort =
    typeof options.store.transports.getBindingCheckpoint === "function";
  const statisticsPort =
    typeof options.store.transports.getStatistics === "function";

  let statsCoverage: RuntimeTransportBindingHealthSnapshot["coverage"]["statistics"] =
    "available";
  let stats = emptyTransportEnvelopeStats();

  if (!statisticsPort) {
    // Adapter/port does not implement the statistics capability.
    statsCoverage = "missing_port";
  } else {
    // Single ledger read: derive both counters and coverage. Unexpected
    // transaction/read failures propagate; do not map them to missing_port.
    const exported = await options.store.transact(async (tx) => {
      if (!tx.transports) {
        throw new TransportStoreMissingError();
      }
      return tx.transports.getStatistics(options.namespace);
    });

    if (exported) {
      stats = transportStatisticsFromExport(exported, options.namespace);
    } else {
      // Honest "missing" for an empty/absent ledger, not fabricated activity.
      statsCoverage = "missing";
    }
  }

  // Deterministic first-64 by binding id (codepoint order), independent of the
  // caller array order when bindings are supplied without a program.
  const ordered = orderBindingsById(bindings);
  const limited = ordered.slice(0, MAX_TRANSPORT_BINDING_HEALTH);
  const checkpointCoverage: ProjectTransportBindingHealthOptions["checkpointCoverage"] =
    checkpointPort ? "available" : "unsupported";
  const checkpoints = checkpointPort
    ? await loadBindingCheckpoints(
        options.store,
        options.namespace,
        limited,
      )
    : undefined;

  const rows: RuntimeTransportBindingHealth[] = [];

  for (const binding of limited) {
    const checkpoint = checkpoints?.get(binding.id) ?? null;

    const provider = resolveProgramProvider(providers, binding);
    const identity = transportStatisticsIdentity(
      binding.adapter.id,
      binding.id,
    );
    const byIdentity = stats.byIdentity[identity];
    let outcomesCoverage: RuntimeTransportBindingHealthOutcomes["coverage"] =
      "missing";
    let outcomes: TransportEnvelopeOutcomeStats | null = null;

    if (byIdentity) {
      outcomesCoverage = "available";
      outcomes = byIdentity;
    } else if (stats.otherIdentities && stats.identityAttribution === "truncated") {
      // Past the first-64 attribution bound — exact per-binding totals are not
      // retained. Report other coverage without inventing identity-specific counts.
      outcomesCoverage = "other";
    } else if (statsCoverage === "missing" || statsCoverage === "missing_port") {
      outcomesCoverage =
        statsCoverage === "missing_port" ? "unavailable" : "missing";
    }

    rows.push(
      projectTransportBindingHealth({
        namespace: options.namespace,
        binding,
        provider,
        checkpoint,
        checkpointCoverage,
        outcomes,
        outcomesCoverage,
        now,
      }),
    );
  }

  return Object.freeze({
    schema: 1 as const,
    namespace: options.namespace,
    observedAt: now.toISOString(),
    bindings: Object.freeze(rows),
    totals: Object.freeze({ ...stats.total }),
    coverage: Object.freeze({
      bindingLimit: MAX_TRANSPORT_BINDING_HEALTH,
      bindings:
        bindings.length > MAX_TRANSPORT_BINDING_HEALTH
          ? ("truncated" as const)
          : ("complete" as const),
      identityAttribution: stats.identityAttribution,
      checkpoints: checkpointPort
        ? ("available" as const)
        : ("unsupported" as const),
      statistics: statsCoverage,
    }),
  });
}

/**
 * Project one binding health row from already-loaded durable facts.
 *
 * @param options - Binding declaration, optional checkpoint/outcomes, and clock.
 * @returns Frozen secret-free health projection.
 */
export function projectTransportBindingHealth(
  options: ProjectTransportBindingHealthOptions,
): RuntimeTransportBindingHealth {
  const { binding, checkpoint, now } = options;
  const transportKind = classifyTransportKind(options.provider);
  const checkpointCoverage = options.checkpointCoverage ?? "available";

  const status = normalizeStatus(checkpoint?.status);
  const statusCoverage = resolveStatusCoverage(checkpoint, checkpointCoverage);

  const cursorPresent =
    checkpoint != null &&
    typeof checkpoint.cursor === "string" &&
    checkpoint.cursor.length > 0;
  const cursorCoverage = resolveCursorCoverage(
    checkpoint,
    cursorPresent,
    checkpointCoverage,
  );
  const ageMs =
    cursorPresent && checkpoint?.updatedAt
      ? ageMilliseconds(checkpoint.updatedAt, now)
      : undefined;

  const ownerId = checkpoint?.lastOwnerId;
  const leaseCoverage = resolveLeaseCoverage(ownerId, checkpointCoverage);

  const lastErrorCode = checkpoint?.lastErrorCode;
  const fault =
    lastErrorCode !== undefined && lastErrorCode.length > 0
      ? Object.freeze({
          coverage: "durable" as const,
          lastErrorCode,
        })
      : Object.freeze({ coverage: "absent" as const });

  const reconnect = Object.freeze({
    coverage: resolveReconnectCoverage(status, lastErrorCode),
  });

  const outcomes = projectOutcomes(options.outcomes, options.outcomesCoverage);

  return Object.freeze({
    schema: 1 as const,
    namespace: options.namespace,
    bindingId: binding.id,
    adapterId: binding.adapter.id,
    provider: binding.adapter.provider,
    configRef: Object.freeze({
      id: binding.configRef.id,
      revision: binding.configRef.revision,
    }),
    target: Object.freeze({
      kind: "signal" as const,
      signalId: binding.target.signalId,
    }),
    transportKind,
    transportKindCoverage:
      transportKind === "unknown"
        ? ("unavailable" as const)
        : ("available" as const),
    status,
    statusCoverage,
    lease: Object.freeze({
      coverage: leaseCoverage,
      ...(ownerId !== undefined ? { ownerId } : {}),
    }),
    cursor: Object.freeze({
      present: cursorPresent,
      coverage: cursorCoverage,
      ...(ageMs !== undefined ? { ageMs } : {}),
      ...(cursorPresent && checkpoint?.updatedAt
        ? { updatedAt: checkpoint.updatedAt }
        : {}),
      ...(checkpoint?.lastPolledAt
        ? { lastAcquiredAt: checkpoint.lastPolledAt }
        : {}),
      lagCoverage: "unavailable" as const,
    }),
    outcomes,
    fault,
    reconnect,
    shutdown: Object.freeze({ coverage: "unavailable" as const }),
    ...(checkpoint?.morePending === true ? { morePending: true } : {}),
    ...(checkpoint?.updatedAt
      ? { checkpointUpdatedAt: checkpoint.updatedAt }
      : {}),
  });
}

function resolveBindings(
  options: TransportBindingHealthOptions,
): readonly RuntimeManagedTransportBinding[] {
  if (options.program) {
    return options.program.transports;
  }
  if (options.bindings) {
    return options.bindings;
  }
  return Object.freeze([]);
}

/** Stable codepoint order used for max-64 truncation coverage. */
function orderBindingsById(
  bindings: readonly RuntimeManagedTransportBinding[],
): readonly RuntimeManagedTransportBinding[] {
  return [...bindings].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/**
 * Load checkpoints for every projected binding in one store transaction.
 *
 * @remarks Avoids an N+1 of per-binding transactions (up to 64 sequential
 * commits) when reading status for Devtools or operators.
 */
async function loadBindingCheckpoints(
  store: RuntimeStoreAdapter,
  namespace: string,
  bindings: readonly RuntimeManagedTransportBinding[],
): Promise<Map<string, RuntimeTransportBindingCheckpoint | null>> {
  return store.transact(async (tx) => {
    const getCheckpoint = tx.transports?.getBindingCheckpoint;
    const result = new Map<string, RuntimeTransportBindingCheckpoint | null>();
    if (!getCheckpoint) {
      return result;
    }

    for (const binding of bindings) {
      result.set(
        binding.id,
        await getCheckpoint({
          namespace,
          bindingId: binding.id,
        }),
      );
    }

    return result;
  });
}

function classifyTransportKind(
  provider: SignalProvider | undefined,
): RuntimeTransportKind {
  if (!provider) {
    return "unknown";
  }
  const transport = provider.transport;
  if (isWebhookTransport(transport)) {
    return "webhook";
  }
  if (isPollingTransport(transport)) {
    return "polling";
  }
  if (isSseTransport(transport)) {
    return "sse";
  }
  if (isWebSocketTransport(transport)) {
    return "websocket";
  }
  if (isManagedStreamTransport(transport)) {
    return "stream";
  }
  return "unknown";
}

function normalizeStatus(
  status: RuntimeTransportBindingStatus | undefined,
): RuntimeTransportBindingStatus {
  if (status === "faulted" || status === "disabled" || status === "active") {
    return status;
  }
  return "active";
}

function resolveStatusCoverage(
  checkpoint: RuntimeTransportBindingCheckpoint | null | undefined,
  checkpointCoverage: ProjectTransportBindingHealthOptions["checkpointCoverage"],
): RuntimeTransportBindingHealth["statusCoverage"] {
  if (checkpointCoverage === "unsupported" || checkpointCoverage === "missing_port") {
    return checkpointCoverage;
  }
  if (!checkpoint) {
    return "defaulted";
  }
  if (
    checkpoint.status === "faulted" ||
    checkpoint.status === "disabled" ||
    checkpoint.status === "active"
  ) {
    return "durable";
  }
  return "defaulted";
}

function resolveCursorCoverage(
  checkpoint: RuntimeTransportBindingCheckpoint | null | undefined,
  present: boolean,
  checkpointCoverage: ProjectTransportBindingHealthOptions["checkpointCoverage"],
): RuntimeTransportBindingHealth["cursor"]["coverage"] {
  if (checkpointCoverage === "unsupported" || checkpointCoverage === "missing_port") {
    return checkpointCoverage;
  }
  if (!checkpoint) {
    return "absent";
  }
  return present ? "durable" : "absent";
}

function resolveLeaseCoverage(
  ownerId: string | undefined,
  checkpointCoverage: ProjectTransportBindingHealthOptions["checkpointCoverage"],
): RuntimeTransportBindingHealth["lease"]["coverage"] {
  if (checkpointCoverage === "unsupported" || checkpointCoverage === "missing_port") {
    return checkpointCoverage;
  }
  if (ownerId !== undefined && ownerId.length > 0) {
    return "last_owner";
  }
  return "absent";
}

function resolveReconnectCoverage(
  status: RuntimeTransportBindingStatus,
  lastErrorCode: string | undefined,
): RuntimeTransportBindingHealth["reconnect"]["coverage"] {
  // Process-local reconnect attempt/delay history is not durable. Exhaustion
  // is visible only when supervision wrote a durable fault with the shared code.
  if (status === "faulted" && lastErrorCode === "TRANSPORT_STREAM_EXHAUSTED") {
    return "durable_exhausted";
  }
  return "unavailable";
}

function projectOutcomes(
  outcomes: TransportEnvelopeOutcomeStats | null | undefined,
  coverage: RuntimeTransportBindingHealthOutcomes["coverage"],
): RuntimeTransportBindingHealthOutcomes {
  if (
    (coverage === "available" || coverage === "other") &&
    outcomes
  ) {
    return Object.freeze({
      coverage,
      accepted: outcomes.accepted,
      deduplicated: outcomes.deduplicated,
      normalized: outcomes.normalized,
      delivered: outcomes.delivered,
      retried: outcomes.retried,
      deadLettered: outcomes.deadLettered,
    });
  }
  return Object.freeze({ coverage });
}

function ageMilliseconds(updatedAt: string, now: Date): number | undefined {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) {
    return undefined;
  }
  const age = now.getTime() - updatedMs;
  return age >= 0 ? age : 0;
}
