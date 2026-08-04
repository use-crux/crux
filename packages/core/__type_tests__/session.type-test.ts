import { expectTypeOf } from "vitest";
import { z } from "zod";
import { getSession, prompt, session } from "../src";
import type {
  ExecutionStats,
  GenerationModel,
  SessionStatus,
  WorkHandle,
} from "../src";
import { agent } from "../src/agent";
import { flow } from "../src/flow";
import type { ThreadSnapshot } from "../src/thread";

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

const created = session(support, { key: "customer:42" });
const reopened = getSession(support, "customer:42");

expectTypeOf(created).toEqualTypeOf<typeof reopened>();
expectTypeOf(created).resolves.toMatchTypeOf<{
  readonly id: string;
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
  // @ts-expect-error Phase 1 acceptance has no joinable output contract.
  accepted.output;
  // @ts-expect-error Session-owned Thread views never expose mutation.
  handle.thread.append({ role: "user", content: "bypass" });
  // @ts-expect-error Session-owned Thread identity is readonly.
  handle.thread.id = "replacement";
  // @ts-expect-error Session input stays target-specific.
  handle.send({ unknown: true });
});

// @ts-expect-error A stable Session key is required.
session(support);

const deferred = flow("session-flow-rejected", async () => "nope");
// @ts-expect-error Sessions are Agent-only.
session(deferred, { key: "not-a-flow" });
