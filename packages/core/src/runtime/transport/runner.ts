/**
 * Restart-safe transport normalization runner.
 *
 * @remarks This runner claims accepted envelopes and invokes provider
 * `onEvent` handlers. It is not a second queue, daemon, or transport lifecycle.
 * Hosts may call {@link TransportNormalizationRunner.runOnce} directly; the
 * existing Runtime worker invokes the same kernel once per maintenance tick.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import { resolveProgramProvider } from "../program-providers";
import type { RuntimeStoreAdapter } from "../store";
import {
  claimTransportEnvelopes,
  normalizeClaimedTransportEnvelope,
} from "./normalize";

/** Options for constructing a host-driven normalization runner. */
export interface CreateTransportNormalizationRunnerOptions {
  /** Runtime store that exposes the transport port. */
  readonly store: RuntimeStoreAdapter;
  /** Runtime namespace scanned for accepted envelopes. */
  readonly namespace: string;
  /**
   * Live provider definitions resolved by stable identity keys.
   *
   * @remarks Matching uses the same deterministic rule as program validation:
   * `adapterId`, `provider`, and `bindingId` form one identity set. Ambiguous
   * multi-provider matches are rejected rather than ordered by precedence.
   */
  readonly providers: readonly SignalProvider[];
}

/** Bounded counters returned by one host-invoked normalization pass. */
export interface TransportNormalizationRunResult {
  readonly claimed: number;
  readonly normalized: number;
  readonly retried: number;
  readonly deadLettered: number;
}

/** Options for one host-invoked claim/normalize pass. */
export interface TransportNormalizationRunOnceOptions {
  readonly now?: Date;
  readonly limit?: number;
  readonly leaseMs?: number;
  readonly rng?: () => number;
}

/**
 * Restart-safe normalization loop for accepted transport envelopes.
 *
 * @remarks Ownership, polling cadence, abort/shutdown, namespace, and storage
 * remain with the host or the existing Runtime worker that invokes
 * {@link TransportNormalizationRunner.runOnce}.
 */
export interface TransportNormalizationRunner {
  /**
   * Claim a bounded batch and normalize each claimed envelope once.
   *
   * @param options - Optional clock, batch size, and lease settings.
   * @returns Bounded counters for the completed pass.
   */
  runOnce(
    options?: TransportNormalizationRunOnceOptions,
  ): Promise<TransportNormalizationRunResult>;
}

/**
 * Create a host-invoked transport normalization runner.
 *
 * @param options - Store, namespace, and live provider definitions.
 * @returns A runner that never starts timers or background tasks by itself.
 */
export function createTransportNormalizationRunner(
  options: CreateTransportNormalizationRunnerOptions,
): TransportNormalizationRunner {
  return Object.freeze({
    async runOnce(
      runOptions: TransportNormalizationRunOnceOptions = {},
    ): Promise<TransportNormalizationRunResult> {
      const claimed = await claimTransportEnvelopes({
        store: options.store,
        namespace: options.namespace,
        now: runOptions.now,
        limit: runOptions.limit,
        leaseMs: runOptions.leaseMs,
      });

      let normalized = 0;
      let retried = 0;
      let deadLettered = 0;

      for (const record of claimed) {
        const provider = resolveProgramProvider(options.providers, {
          adapterId: record.envelope.adapterId,
          provider: record.provider,
          bindingId: record.bindingId,
        });
        if (!provider) {
          const failed = await normalizeClaimedTransportEnvelope({
            store: options.store,
            provider: missingProvider(record.envelope.adapterId),
            record,
            now: runOptions.now,
            rng: runOptions.rng,
          });
          if (failed.kind === "retried") retried += 1;
          else if (failed.kind === "dead-lettered") deadLettered += 1;
          continue;
        }

        const result = await normalizeClaimedTransportEnvelope({
          store: options.store,
          provider,
          record,
          now: runOptions.now,
          rng: runOptions.rng,
        });
        if (result.kind === "normalized") normalized += 1;
        else if (result.kind === "retried") retried += 1;
        else if (result.kind === "dead-lettered") deadLettered += 1;
      }

      return Object.freeze({
        claimed: claimed.length,
        normalized,
        retried,
        deadLettered,
      });
    },
  });
}

function missingProvider(adapterId: string): SignalProvider {
  return Object.freeze({
    _tag: "SignalProvider" as const,
    id: adapterId,
    transport: Object.freeze({
      _tag: "WebhookTransport" as const,
      kind: "webhook" as const,
      handle: async () => {
        throw new Error(`Missing provider for adapter \`${adapterId}\`.`);
      },
    }),
    signals: Object.freeze({}),
    async onEvent() {
      throw Object.assign(
        new Error(`No Signal provider registered for adapter \`${adapterId}\`.`),
        { code: "TRANSPORT_PROVIDER_MISSING" },
      );
    },
  });
}
