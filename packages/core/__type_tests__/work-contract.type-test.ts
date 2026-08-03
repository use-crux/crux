/** Compile the canonical public Work contract against exported Flow targets. */

import { expectTypeOf } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  type CancelReceipt,
  type DetachReceipt,
  type WorkEvent,
  type WorkFailure,
  type WorkHandle,
  type WorkProgress,
  type WorkStatus,
  type CreateWorkHostOptions,
  type WorkHost,
} from "@use-crux/core/work";
import { z } from "zod";

const review = flow(
  "review-document",
  {
    signals: {
      approval: z.object({ approvedBy: z.string() }),
    },
  },
  async (
    _scope,
    input: {
      readonly documentId: string;
      readonly route: readonly [kind: "legal" | "policy", priority: 1 | 2];
    },
  ) =>
    ({
      documentId: input.documentId,
      acceptedRoute: input.route,
    }) as const,
);

const cleanup = flow("cleanup-document", async () => "done" as const);

type ReviewResult = {
  readonly documentId: string;
  readonly acceptedRoute: readonly [
    kind: "legal" | "policy",
    priority: 1 | 2,
  ];
};

declare const work: WorkHandle<ReviewResult>;
declare const hostOptions: CreateWorkHostOptions;
expectTypeOf(createWorkHost(hostOptions)).toEqualTypeOf<WorkHost>();
expectTypeOf(work.id).toEqualTypeOf<string>();
expectTypeOf(work.result()).toEqualTypeOf<Promise<ReviewResult>>();
expectTypeOf(work.status()).toEqualTypeOf<Promise<WorkStatus>>();
expectTypeOf(work.progress).parameter(0).toEqualTypeOf<WorkProgress>();
expectTypeOf(work.stream()).toEqualTypeOf<AsyncIterable<WorkEvent>>();
expectTypeOf(work.cancel()).toEqualTypeOf<Promise<CancelReceipt>>();
expectTypeOf(work.detach()).toEqualTypeOf<Promise<DetachReceipt>>();
// @ts-expect-error — handles are result-generic, never target-qualified.
work.targetId;

const spawned = await spawn(
  review,
  { documentId: "doc_1", route: ["legal", 1] },
  { idempotencyKey: "request_1" },
);
expectTypeOf(spawned).toEqualTypeOf<WorkHandle<ReviewResult>>();
expectTypeOf(await getWork(review, spawned.id)).toEqualTypeOf<
  WorkHandle<ReviewResult>
>();

const inputless = await spawn(cleanup, { idempotencyKey: "request_2" });
const explicitUndefined = await spawn(
  cleanup,
  undefined,
  { idempotencyKey: "request_3" },
);
expectTypeOf(inputless.result()).toEqualTypeOf<Promise<"done">>();
expectTypeOf(explicitUndefined.result()).toEqualTypeOf<Promise<"done">>();

declare const status: WorkStatus;
if (status.state === "failed") {
  expectTypeOf(status.failure).toEqualTypeOf<WorkFailure>();
  // @ts-expect-error — safe status summaries never carry raw failures.
  status.error;
}
if (status.state === "completed") {
  expectTypeOf(status.resultAvailable).toEqualTypeOf<boolean>();
  // @ts-expect-error — results are obtained only through result().
  status.result;
}

// @ts-expect-error — required Flow input cannot be omitted.
await spawn(review, { idempotencyKey: "missing-input" });
// @ts-expect-error — inline callbacks are not Work targets.
await spawn(async () => "nope", { idempotencyKey: "inline" });
// @ts-expect-error — unsupported values are not Work targets.
await spawn("review-document", { idempotencyKey: "unsupported" });
// @ts-expect-error — caller-owned idempotency is required.
await spawn(review, { documentId: "doc_1", route: ["legal", 1] }, {});
