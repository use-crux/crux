/**
 * Real workerd fixture Worker for Phase 7 conformance tests.
 *
 * Runs inside `@cloudflare/vitest-pool-workers`, not a mocked `waitUntil` or
 * `@edge-runtime/vm`. Test files import this module directly (getting the
 * exact same module instance the pool uses for `fetch`, per the pool's
 * documented module-cache sharing) to drive test-only controls alongside
 * real requests.
 */

/// <reference types="@cloudflare/workers-types" />

import {
  acceptedDeliveryReceipt,
  observabilityDiagnostics,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxDeliveryReceipt,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
  type ObservabilityFlushResult,
} from "@use-crux/core/observability";
import { withCrux, type CruxWorkersInvocation } from "../../../src";

let delivered: CruxGraphRecord[] = [];
let transportDelayMs = 0;
let maxQueuedBytes: number | undefined;
let latestDrain: ObservabilityFlushResult | undefined;

function installTransport(): void {
  const transport: CruxObservabilityTransport = {
    async send(records): Promise<CruxDeliveryReceipt> {
      if (transportDelayMs > 0) await sleep(transportDelayMs);
      delivered.push(...records);
      return acceptedDeliveryReceipt(records);
    },
  };
  setObservabilityTransport(transport, {
    scheduledDelayMs: 0,
    ...(maxQueuedBytes === undefined ? {} : { maxQueuedBytes }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

installTransport();

/** Test-only: reset delivered/transport state for a fresh scenario. */
export function resetFixture(options?: {
  transportDelayMs?: number;
  maxQueuedBytes?: number;
}): void {
  resetObservabilityRuntime();
  delivered = [];
  transportDelayMs = options?.transportDelayMs ?? 0;
  maxQueuedBytes = options?.maxQueuedBytes;
  latestDrain = undefined;
  installTransport();
}

/** Test-only: records the fixture transport has actually delivered so far. */
export function deliveredRecords(): readonly CruxGraphRecord[] {
  return delivered;
}

/** Test-only: current bounded delivery diagnostics. */
export function fixtureDiagnostics() {
  return observabilityDiagnostics();
}

/** Test-only: most recent structured wrapper drain result. */
export function latestDrainResult(): ObservabilityFlushResult | undefined {
  return latestDrain;
}

function invocationFor(url: URL): CruxWorkersInvocation | undefined {
  const timeoutParam = url.searchParams.get("flushTimeoutMs");
  if (timeoutParam === null) return undefined;
  return {
    flushTimeoutMs: Number(timeoutParam),
    onDrain: (result) => {
      latestDrain = result;
    },
  };
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId") ?? "unknown";

  switch (url.pathname) {
    case "/emit": {
      const run = observe.openRun({
        name: `workers-request-${requestId}`,
        rootPrimitive: "run",
      });
      run.end();
      return Response.json({ ok: true, requestId });
    }
    case "/emit-and-throw": {
      const run = observe.openRun({
        name: `workers-request-${requestId}`,
        rootPrimitive: "run",
      });
      run.end();
      throw new Error(`intentional failure for ${requestId}`);
    }
    case "/continuation/start": {
      const run = observe.openRun({
        name: "continuation-start",
        rootPrimitive: "run",
      });
      const carrier = run.suspend({ reason: "cross-isolate handoff" });
      return Response.json({ carrier });
    }
    default:
      return new Response("not found", { status: 404 });
  }
}

const handleFetch = withCrux(
  (request: Request, _env: unknown, _ctx: ExecutionContext) => route(request),
  {
    context: (_request, _env, ctx) => ctx,
    invocation: (_ctx, request) => invocationFor(new URL(request.url)),
  },
);

export default {
  fetch: handleFetch,
} satisfies ExportedHandler;
