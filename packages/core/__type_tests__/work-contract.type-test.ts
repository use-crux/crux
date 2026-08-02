/** Public durable Work type contract for exported Flows. */

import { expectTypeOf } from "vitest";
import {
  flow,
  getWork,
  spawn,
  type WorkEvent,
  type WorkHandle,
  type WorkId,
  type WorkProgress,
  type WorkStatus,
} from "@use-crux/core";

const review = flow(
  "review-document",
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

const translate = flow(
  "translate-document",
  async (_scope, input: { readonly documentId: string }) =>
    ({
      translated: input.documentId,
    }) as const,
);

declare const work: WorkHandle<typeof review>;
expectTypeOf(review.name).toEqualTypeOf<"review-document">();
expectTypeOf(work.id).toEqualTypeOf<WorkId<typeof review>>();
expectTypeOf(work.targetId).toEqualTypeOf<"review-document">();
expectTypeOf(work.result()).toEqualTypeOf<
  Promise<{
    readonly documentId: string;
    readonly acceptedRoute: readonly [
      kind: "legal" | "policy",
      priority: 1 | 2,
    ];
  }>
>();
expectTypeOf(work.status()).toEqualTypeOf<Promise<WorkStatus<typeof review>>>();
expectTypeOf(work.progress).parameter(0).toEqualTypeOf<WorkProgress>();
expectTypeOf(work.stream()).toEqualTypeOf<
  AsyncIterable<WorkEvent<typeof review>>
>();

const spawned = await spawn(
  review,
  { documentId: "doc_1", route: ["legal", 1] },
  { idempotencyKey: "request_1" },
);
expectTypeOf(spawned).toEqualTypeOf<WorkHandle<typeof review>>();
expectTypeOf(await getWork(review, spawned.id)).toEqualTypeOf<
  WorkHandle<typeof review>
>();

declare const status: WorkStatus<typeof review>;
declare const readonlyStatus: WorkStatus<typeof review>;
// @ts-expect-error — public Work state is a readonly snapshot.
readonlyStatus.state = "running";
if (status.state === "completed") {
  expectTypeOf(status.result).toEqualTypeOf<{
    readonly documentId: string;
    readonly acceptedRoute: readonly [
      kind: "legal" | "policy",
      priority: 1 | 2,
    ];
  }>();
  // @ts-expect-error — terminal results are readonly snapshot data.
  status.result = { documentId: "doc_2", acceptedRoute: ["policy", 2] };
} else {
  // @ts-expect-error — a result exists only after successful completion.
  status.result;
}
if (status.state === "failed") {
  expectTypeOf(status.error).toEqualTypeOf<unknown>();
  // @ts-expect-error — failed Work has no successful result.
  status.result;
}

// @ts-expect-error — Flow input retains its exact tuple and literals.
await spawn(
  review,
  { documentId: "doc_1", route: ["finance", 1] },
  { idempotencyKey: "bad" },
);
// @ts-expect-error — target input fields cannot be omitted.
await spawn(review, { documentId: "doc_1" }, { idempotencyKey: "bad" });
// @ts-expect-error — top-level Work requires a caller-owned idempotency key.
await spawn(review, { documentId: "doc_1", route: ["legal", 1] }, {});
// @ts-expect-error — lookup IDs are qualified by stable target identity.
await getWork(translate, spawned.id);
