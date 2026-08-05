import { expectTypeOf } from "vitest";
import { z } from "zod";
import { getSession, prompt, session, signal } from "../src";
import type {
  ExecutionStats,
  GenerationModel,
  SessionStatus,
  WorkHandle,
  WorkProgress,
} from "../src";
import { agent } from "../src/agent";
import { flow } from "../src/flow";
import type { ThreadSnapshot } from "../src/thread";
import type {
  SessionForTarget,
  SessionTargetInput,
  SessionTargetOutput,
  SessionTargetResume,
} from "../src/session/target-types";

declare const sessionModel: GenerationModel;

const support = agent({
  id: "session-support",
  prompt: prompt({
    id: "session-support-prompt",
    input: z.object({ message: z.string() }),
    output: z.object({ reply: z.string() }),
    system: "Reply helpfully.",
  }),
  model: sessionModel,
});

const approval = signal({
  id: "review.approved",
  schema: z.object({ approvedBy: z.string() }),
});

const agentIngress = signal({
  id: "agent.ingress",
  schema: z.object({ message: z.string() }),
});

const created = session(support, { key: "customer:42" });
const reopened = getSession(support, "customer:42");

expectTypeOf(created).toEqualTypeOf<typeof reopened>();
expectTypeOf(created).resolves.toMatchTypeOf<{
  readonly id: string;
  readonly targetKind: "agent";
  readonly thread: { readonly id: string; read(): Promise<unknown> };
  send(input: { message: string }): Promise<{
    readonly id: string;
    readonly cursor: string;
    readonly acceptedAt: Date;
  }>;
}>();

void created.then(async (handle) => {
  const accepted = await handle.send({ message: "Hello" });
  expectTypeOf(accepted.id).toEqualTypeOf<string>();
  expectTypeOf(accepted.work()).resolves.toEqualTypeOf<
    WorkHandle<{ reply: string }>
  >();
  expectTypeOf(accepted.result()).resolves.toEqualTypeOf<{ reply: string }>();
  expectTypeOf(handle.status()).resolves.toEqualTypeOf<SessionStatus>();
  expectTypeOf(handle.stats()).resolves.toEqualTypeOf<ExecutionStats>();
  expectTypeOf(handle.thread.read()).resolves.toEqualTypeOf<ThreadSnapshot>();
  expectTypeOf(handle.close()).resolves.toEqualTypeOf<void>();
  expectTypeOf(handle.kill()).resolves.toEqualTypeOf<void>();
  expectTypeOf(handle.delete()).resolves.toEqualTypeOf<void>();
  void handle.fork().then((child) => {
    expectTypeOf(child.targetKind).toEqualTypeOf<"agent">();
    expectTypeOf(child.send).parameters.toEqualTypeOf<
      [{ message: string }]
    >();
  });
  void handle.clone().then((child) => {
    expectTypeOf(child.targetKind).toEqualTypeOf<"agent">();
  });
  expectTypeOf(handle.forks()).resolves.items.toMatchTypeOf<{
    readonly sessionId: string;
  }>();
  // @ts-expect-error Phase 1 acceptance has no joinable output contract.
  accepted.output;
  // @ts-expect-error Session-owned Thread views never expose mutation.
  handle.thread.append({ role: "user", content: "bypass" });
  // @ts-expect-error Session-owned Thread identity is readonly.
  handle.thread.id = "replacement";
  // @ts-expect-error Session input stays target-specific.
  handle.send({ unknown: true });
  const subscription = await handle.subscribe(agentIngress);
  expectTypeOf(subscription.signalId).toEqualTypeOf<string>();
  expectTypeOf(handle.subscriptions()).resolves.toMatchTypeOf<
    readonly {
      readonly id: string;
      readonly signalId: string;
      unsubscribe(): Promise<void>;
    }[]
  >();
  expectTypeOf(handle.stream).toBeFunction();
  // Predicate closures are rejected at runtime (subscribeSession); match filters
  // remain the durable public surface.
});

// @ts-expect-error A stable Session key is required.
session(support);

const review = flow(
  "session-flow-review",
  { signals: { approval } },
  async (scope, input: { readonly documentId: string }) => {
    const occurrence = await scope.waitFor(approval);
    return {
      documentId: input.documentId,
      approvedBy: occurrence.payload.approvedBy,
    } as const;
  },
);

type ReviewSession = SessionForTarget<typeof review>;
expectTypeOf<SessionTargetInput<typeof review>>().toEqualTypeOf<{
  readonly documentId: string;
}>();
expectTypeOf<SessionTargetOutput<typeof review>>().toEqualTypeOf<{
  readonly documentId: string;
  readonly approvedBy: string;
}>();
expectTypeOf<SessionTargetResume<typeof review>>().toEqualTypeOf<{
  approvedBy: string;
}>();
expectTypeOf<SessionTargetResume<typeof support>>().toEqualTypeOf<never>();
expectTypeOf<WorkProgress>().toEqualTypeOf<
  import("../src/work/progress").WorkProgress
>();

const flowCreated = session(review, { key: "document:7" });
const flowReopened = getSession(review, "document:7");
expectTypeOf(flowCreated).toEqualTypeOf<typeof flowReopened>();
expectTypeOf(flowCreated).resolves.toEqualTypeOf<ReviewSession>();

void flowCreated.then(async (handle) => {
  expectTypeOf(handle.targetKind).toEqualTypeOf<"flow">();
  const accepted = await handle.send({ documentId: "doc_7" });
  expectTypeOf(accepted.result()).resolves.toEqualTypeOf<{
    readonly documentId: string;
    readonly approvedBy: string;
  }>();
  const subscription = await handle.subscribe(approval);
  expectTypeOf(subscription.signalId).toEqualTypeOf<string>();
  expectTypeOf(handle.subscriptions()).resolves.toMatchTypeOf<
    readonly {
      readonly id: string;
      readonly signalId: string;
      unsubscribe(): Promise<void>;
    }[]
  >();
  expectTypeOf(handle.stream).toBeFunction();
  // @ts-expect-error Flow Sessions reject Agent-only model options.
  await session(review, { key: "document:8", model: sessionModel });
  // @ts-expect-error Flow Session input stays target-specific.
  handle.send({ message: "nope" });
  // @ts-expect-error Predicate closures are not durable Session subscriptions.
  handle.subscribe(approval.when((event) => event.approvedBy === "ops"));
});

const voidFlow = flow("session-flow-void", async () => "done" as const);
const primitiveFlow = flow(
  "session-flow-primitive",
  async (_scope, input: number) => input,
);
expectTypeOf<SessionTargetInput<typeof voidFlow>>().toEqualTypeOf<void>();
expectTypeOf<SessionTargetOutput<typeof voidFlow>>().toEqualTypeOf<"done">();
expectTypeOf<SessionTargetInput<typeof primitiveFlow>>().toEqualTypeOf<number>();
expectTypeOf<SessionTargetOutput<typeof primitiveFlow>>().toEqualTypeOf<number>();

// SessionForTarget retains Flow input/result inference on send/result.
type VoidSession = SessionForTarget<typeof voidFlow>;
type PrimitiveSession = SessionForTarget<typeof primitiveFlow>;
type _VoidSendArg = Parameters<VoidSession["send"]>[0];
type _PrimitiveSendArg = Parameters<PrimitiveSession["send"]>[0];
type _VoidResult = Awaited<
  ReturnType<Awaited<ReturnType<VoidSession["send"]>>["result"]>
>;
type _PrimitiveResult = Awaited<
  ReturnType<Awaited<ReturnType<PrimitiveSession["send"]>>["result"]>
>;
const _voidSendOk: _VoidSendArg = undefined as void;
const _primitiveSendOk: _PrimitiveSendArg = 7;
const _voidResultOk: _VoidResult = "done";
const _primitiveResultOk: _PrimitiveResult = 7;
void _voidSendOk;
void _primitiveSendOk;
void _voidResultOk;
void _primitiveResultOk;

void session(voidFlow, { key: "void:1" }).then(async (handle) => {
  const accepted = await handle.send(undefined as void);
  expectTypeOf(accepted.result()).resolves.toEqualTypeOf<"done">();
});
void session(primitiveFlow, { key: "n:1" }).then(async (handle) => {
  const accepted = await handle.send(7);
  expectTypeOf(accepted.result()).resolves.toEqualTypeOf<number>();
  // @ts-expect-error Primitive Flow Sessions reject object payloads.
  handle.send({ value: 7 });
});

// @ts-expect-error Unsupported dynamic targets are not Sessions.
session(async () => "nope", { key: "inline" });
// @ts-expect-error Bare strings are not Sessions.
session("session-flow-review", { key: "name-only" });
