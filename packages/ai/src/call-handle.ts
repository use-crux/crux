/**
 * Sans-I/O handle and transport helpers for the AI SDK adapter.
 *
 * The helpers pause at the package's `SdkGateway` seam. The existing AI SDK
 * codec still plans params and decodes raw SDK results; this module only owns
 * the manual wire boundary used by `prepare()` and `transport`.
 *
 * @module
 */

import type { LanguageModel } from "ai";
import type { CallHandle, GenerateResult } from "@use-crux/core/adapter";
import {
  CruxIncompleteCallError,
  CruxStaleHandleError,
} from "@use-crux/core/adapter";
import type { SdkGateway } from "./gateway";
import type { AITransport } from "./options";
import { extractModelInfo } from "./provider-profile";
import type { SdkLoopResultLike } from "./sdk-codec";

interface PendingAiSdkCall {
  readonly version: number;
  readonly params: Record<string, unknown>;
  resolve(value: SdkLoopResultLike): void;
  reject(error: unknown): void;
}

export interface ManualAiSdkGatewayController {
  generateText(args: Parameters<SdkGateway["generateText"]>[0]): ReturnType<SdkGateway["generateText"]>;
  generateObject(args: Parameters<SdkGateway["generateObject"]>[0]): ReturnType<SdkGateway["generateObject"]>;
  first(): Promise<PendingAiSdkCall>;
  advance(
    pending: PendingAiSdkCall,
    raw: SdkLoopResultLike,
  ): Promise<{ readonly done: true; readonly result: GenerateResult<SdkLoopResultLike | undefined> }>;
  fail(error: unknown): void;
  complete(result: GenerateResult<SdkLoopResultLike | undefined>): void;
}

/** Create a gateway controller that pauses on the next AI SDK call. */
export function createManualAiSdkGatewayController(): ManualAiSdkGatewayController {
  let version = 0;
  let pending: PendingAiSdkCall | undefined;
  let completed: GenerateResult<SdkLoopResultLike | undefined> | undefined;
  let failed: unknown;
  const waiters: Array<(pending: PendingAiSdkCall) => void> = [];
  const doneWaiters: Array<(outcome: { result?: GenerateResult<SdkLoopResultLike | undefined>; error?: unknown }) => void> = [];

  const call = (params: Record<string, unknown>): Promise<SdkLoopResultLike> => {
    if (failed !== undefined) return Promise.reject(failed);
    version += 1;
    return new Promise((resolve, reject) => {
      pending = { version, params, resolve, reject };
      for (const waiter of waiters.splice(0)) waiter(pending);
    });
  };

  const waitNextOrDone = async (): Promise<
    | { readonly kind: "pending"; readonly pending: PendingAiSdkCall }
    | { readonly kind: "done"; readonly result: GenerateResult<SdkLoopResultLike | undefined> }
  > => {
    if (failed !== undefined) throw failed;
    if (completed !== undefined) return { kind: "done", result: completed };
    if (pending) return { kind: "pending", pending };

    return new Promise((resolve, reject) => {
      waiters.push((next) => resolve({ kind: "pending", pending: next }));
      doneWaiters.push((outcome) => {
        if (outcome.error !== undefined) reject(outcome.error);
        else if (outcome.result !== undefined) resolve({ kind: "done", result: outcome.result });
      });
    });
  };

  return {
    generateText(args) {
      return call(args as Record<string, unknown>) as ReturnType<SdkGateway["generateText"]>;
    },
    generateObject(args) {
      return call(args as Record<string, unknown>) as ReturnType<SdkGateway["generateObject"]>;
    },
    async first() {
      const next = await waitNextOrDone();
      if (next.kind === "done") {
        throw new Error("AI SDK call handle completed before producing SDK params.");
      }
      return next.pending;
    },
    async advance(current, raw) {
      if (pending?.version !== current.version) throw new CruxStaleHandleError();
      pending = undefined;
      current.resolve(raw);
      const next = await waitNextOrDone();
      if (next.kind === "done") return { done: true, result: next.result };
      throw new CruxIncompleteCallError("AI SDK call handle produced another SDK call; use generate() for SDK-owned loops.");
    },
    fail(error) {
      failed = error;
      pending?.reject(error);
      for (const waiter of doneWaiters.splice(0)) waiter({ error });
    },
    complete(result) {
      completed = result;
      for (const waiter of doneWaiters.splice(0)) waiter({ result });
    },
  };
}

/** Build a public call handle for one pending AI SDK gateway call. */
export function aiSdkHandleFor(
  pending: Awaited<ReturnType<ManualAiSdkGatewayController["first"]>>,
  controller: ManualAiSdkGatewayController,
): CallHandle<Record<string, unknown>, SdkLoopResultLike, GenerateResult<SdkLoopResultLike | undefined>> {
  return Object.freeze({
    params: pending.params,
    async step(response: SdkLoopResultLike) {
      return controller.advance(pending, response);
    },
    async finish(response: SdkLoopResultLike) {
      return (await controller.advance(pending, response)).result;
    },
  });
}

/** Convert an AI SDK transport callback into the gateway shape the executor already uses. */
export function transportGateway(transport: AITransport): SdkGateway {
  let stepIndex = 0;
  const invoke = async (
    params: Parameters<SdkGateway["generateText"]>[0] | Parameters<SdkGateway["generateObject"]>[0],
  ) => {
    const signal = readAbortSignal(params) ?? new AbortController().signal;
    return transport(params, {
      stepIndex: stepIndex++,
      modelId: modelIdForParams(params),
      signal,
    });
  };

  return {
    generateImage: () => {
      throw new TypeError("AI SDK language transports do not support generateImage().");
    },
    transcribe: () => {
      throw new TypeError("AI SDK language transports do not support transcribe().");
    },
    generateText: (args) => invoke(args) as ReturnType<SdkGateway["generateText"]>,
    generateObject: (args) => invoke(args) as ReturnType<SdkGateway["generateObject"]>,
    streamText: () => {
      throw new TypeError("AI SDK transport does not support streamText().");
    },
    streamObject: () => {
      throw new TypeError("AI SDK transport does not support streamObject().");
    },
    embedMany: () => {
      throw new TypeError("AI SDK transport does not support embedMany().");
    },
    rerank: () => {
      throw new TypeError("AI SDK transport does not support rerank().");
    },
  };
}

function readAbortSignal(value: unknown): AbortSignal | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const signal = (value as { readonly abortSignal?: unknown }).abortSignal;
  return signal instanceof AbortSignal ? signal : undefined;
}

function modelIdForParams(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const model = (value as { readonly model?: unknown }).model;
  const info = extractModelInfo(model as LanguageModel);
  return info.modelId || info.provider;
}
