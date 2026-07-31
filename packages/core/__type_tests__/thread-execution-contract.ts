/** Public type contract for Thread-backed managed prompt and agent execution. */

import { expectTypeOf } from "vitest";
import { agent } from "../src/agent";
import type { GenerateResult, StreamCompletion } from "../src/adapter";
import { prompt, type ContextEntry, type ThreadHistoryEntry } from "../src";
import { thread, type ThreadCommit } from "../src/thread";

const conversation = thread({ id: "type-thread" });
expectTypeOf(conversation).toMatchTypeOf<ThreadHistoryEntry>();
expectTypeOf(conversation).toMatchTypeOf<ContextEntry>();

const answer = prompt({
  id: "type-thread-answer",
  use: [conversation],
  prompt: "Answer",
});

agent({
  id: "type-thread-agent",
  prompt: answer,
});

declare const generated: GenerateResult<unknown>;
expectTypeOf(generated.threadCommit).toEqualTypeOf<
  ThreadCommit | undefined
>();

declare const streamed: StreamCompletion;
expectTypeOf(streamed.threadCommit).toEqualTypeOf<
  ThreadCommit | undefined
>();
