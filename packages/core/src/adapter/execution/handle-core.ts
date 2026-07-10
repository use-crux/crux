/**
 * Core-step call-handle execution.
 *
 * The implementation deliberately runs `generateCore()` and swaps only the
 * provider `call()` function for a manual pause/resume boundary. Protocol
 * behavior therefore stays in the managed executor instead of being copied
 * into the handle shell.
 *
 * @internal
 * @module
 */

import type { AdapterResponse } from "../types";
import {
  CruxIncompleteCallError,
  CruxStaleHandleError,
  type CallHandle,
  type CallStepOutcome,
} from "../call-handle";
import type {
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  CoreStepDialect,
} from "./types";
import { generateCore } from "./generate-core";

interface PendingCall<TParams, TRawResponse> {
  readonly version: number;
  readonly params: TParams;
  resolve(value: { readonly raw: TRawResponse; readonly extracted: AdapterResponse }): void;
  reject(error: unknown): void;
}

interface ManualController<TParams, TRawResponse, TResult> {
  readonly call: (
    params: TParams,
  ) => Promise<{ readonly raw: TRawResponse; readonly extracted: AdapterResponse }>;
  first(): Promise<PendingCall<TParams, TRawResponse>>;
  advance(
    pending: PendingCall<TParams, TRawResponse>,
    raw: TRawResponse,
    extracted: AdapterResponse,
    decode: (raw: TRawResponse) => AdapterResponse,
  ): Promise<CallStepOutcome<TParams, TRawResponse, TResult>>;
  fail(error: unknown): void;
  complete(result: TResult): void;
}

/** Prepare a core-step handle by running the managed loop up to its first provider call. */
export async function prepareCoreHandle<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
  TParams,
>(
  dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>,
  args: AdapterExecutionGenerateArgs<string, TExtra>,
  codecs: {
    readonly toParams: (args: Parameters<CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>["call"]>[1]) => TParams | Promise<TParams>;
    readonly fromResponse: (raw: TRawResponse) => AdapterResponse;
  },
): Promise<CallHandle<TParams, TRawResponse, AdapterExecutionGenerateResult<TRawResponse>>> {
  const controller = createManualController<TParams, TRawResponse, AdapterExecutionGenerateResult<TRawResponse>>();
  const manualDialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra> = {
    ...dialect,
    async call(_client, callArgs) {
      return controller.call(await codecs.toParams(callArgs));
    },
  };

  void generateCore(manualDialect, args)
    .then((result) => controller.complete(result))
    .catch((error) => controller.fail(error));

  return handleFor(await controller.first(), controller, codecs.fromResponse);
}

const HANDLE_IDLE_WARNING_MS = 30_000;

function createManualController<TParams, TRawResponse, TResult>(): ManualController<TParams, TRawResponse, TResult> {
  let version = 0;
  let pending: PendingCall<TParams, TRawResponse> | undefined;
  let completed: TResult | undefined;
  let failed: unknown;
  const waiters: Array<(pending: PendingCall<TParams, TRawResponse>) => void> = [];
  const doneWaiters: Array<(outcome: { result?: TResult; error?: unknown }) => void> = [];

  function notifyDone(outcome: { result?: TResult; error?: unknown }): void {
    for (const waiter of doneWaiters.splice(0)) waiter(outcome);
  }

  async function waitNextOrDone(): Promise<
    | { readonly kind: "pending"; readonly pending: PendingCall<TParams, TRawResponse> }
    | { readonly kind: "done"; readonly result: TResult }
  > {
    if (failed !== undefined) throw failed;
    if (completed !== undefined) return { kind: "done", result: completed };
    if (pending) return { kind: "pending", pending };

    return new Promise((resolve, reject) => {
      waiters.push((next) => resolve({ kind: "pending", pending: next }));
      doneWaiters.push((outcome) => {
        if (outcome.error !== undefined) reject(outcome.error);
        else resolve({ kind: "done", result: outcome.result as TResult });
      });
    });
  }

  return {
    call(params) {
      if (failed !== undefined) return Promise.reject(failed);
      version += 1;
      return new Promise((resolve, reject) => {
        pending = { version, params, resolve, reject };
        for (const waiter of waiters.splice(0)) waiter(pending);
      });
    },
    async first() {
      const next = await waitNextOrDone();
      if (next.kind === "done") {
        throw new Error("Call handle completed before producing provider params.");
      }
      return next.pending;
    },
    async advance(current, raw, extracted, decode) {
      if (pending?.version !== current.version) throw new CruxStaleHandleError();
      pending = undefined;
      current.resolve({ raw, extracted });
      const next = await waitNextOrDone();
      if (next.kind === "done") return { done: true, result: next.result };
      return { done: false, next: handleFor(next.pending, this, decode) };
    },
    fail(error) {
      failed = error;
      pending?.reject(error);
      notifyDone({ error });
    },
    complete(result) {
      completed = result;
      notifyDone({ result });
    },
  };
}

function handleFor<TParams, TRawResponse, TResult>(
  pending: PendingCall<TParams, TRawResponse>,
  controller: ManualController<TParams, TRawResponse, TResult>,
  decode: (raw: TRawResponse) => AdapterResponse,
): CallHandle<TParams, TRawResponse, TResult> {
  const warningTimer = createHandleWarningTimer();
  const consume = (): void => {
    if (warningTimer) clearTimeout(warningTimer);
  };

  return Object.freeze({
    params: pending.params,
    step(response) {
      consume();
      return controller.advance(pending, response, decode(response), decode);
    },
    async finish(response) {
      consume();
      const outcome = await controller.advance(pending, response, decode(response), decode);
      if (outcome.done) return outcome.result;
      throw new CruxIncompleteCallError("Call is incomplete; another provider response is required.");
    },
  });
}

function createHandleWarningTimer(): ReturnType<typeof setTimeout> | undefined {
  if (isProduction()) return undefined;

  const timer = setTimeout(() => {
    console.warn(
      "Crux call handle has been idle for 30s. Call handle.step(response) or handle.finish(response) to resume the managed executor.",
    );
  }, HANDLE_IDLE_WARNING_MS);

  (timer as { unref?: () => void }).unref?.();
  return timer;
}

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}
