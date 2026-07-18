import {
  MAX_WAKE_ENVELOPE_BYTES,
  type CruxEngineCapabilities,
  type HostBoundRuntimeEngineDefinition,
  type RuntimeRetentionConfig,
} from "@use-crux/core/runtime";

/** Generated Worker entry required to bind Cloudflare Runtime declarations. */
export const CLOUDFLARE_RUNTIME_ENTRY =
  "createCloudflareEvalHost(...) in the generated Cloudflare Worker entry";

/** Options accepted by {@link cloudflare}. */
export interface CloudflareRuntimeEngineOptions {
  /** Durable Object Runtime namespace. */
  readonly namespace?: string;
  /** Retention policy for terminal Runtime records. */
  readonly retention?: RuntimeRetentionConfig;
}

/** Inert host-bound Runtime Engine declaration for Cloudflare Workers. */
export type CloudflareRuntimeEngineDefinition =
  HostBoundRuntimeEngineDefinition<CloudflareRuntimeEngineOptions>;

/** Declare Cloudflare as the Runtime Engine host. */
export function cloudflare(
  options: CloudflareRuntimeEngineOptions = {},
): CloudflareRuntimeEngineDefinition {
  return Object.freeze({
    kind: "host-bound" as const,
    id: "cloudflare",
    host: "cloudflare",
    capabilities: CLOUDFLARE_RUNTIME_CAPABILITIES,
    entry: CLOUDFLARE_RUNTIME_ENTRY,
    ...(options.namespace ? { namespace: options.namespace } : {}),
    ...(options.retention ? { retention: options.retention } : {}),
    options: Object.freeze({ ...options }),
  });
}

export const CLOUDFLARE_RUNTIME_CAPABILITIES: CruxEngineCapabilities =
  Object.freeze({
    timers: Object.freeze({ durable: true }),
    wake: Object.freeze({
      atLeastOnce: true,
      signed: true,
      maxPayloadBytes: MAX_WAKE_ENVELOPE_BYTES,
    }),
    events: Object.freeze({ durable: true, cursorReads: true }),
    waiters: Object.freeze({ durable: true }),
    leases: Object.freeze({ durable: true }),
    live: Object.freeze({ available: false }),
    setup: Object.freeze({ canCheck: false, canApply: false }),
    deployment: Object.freeze({
      serverless: "supported",
      edge: "supported",
      multiProcess: "supported",
    }),
  });
