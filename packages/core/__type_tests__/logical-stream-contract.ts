/**
 * Compile-time contract for the managed logical stream (RFC #173, contract 06).
 *
 * These assertions are the public shape: they must fail to compile if a bypass surface
 * reappears, if the result shape starts depending on schema gates or execution route, or
 * if partials drift from canonical `z.input`.
 *
 * @module
 */

import type { z } from "zod";
import type { CruxRunId, OperationResultMeta } from "../src/observability";
import type { TokenUsage } from "../src/generation/types";
import type {
  AdapterStreamResult,
  AsyncIterableStream,
  DeepPartial,
  StreamEvent,
  StreamResult,
} from "../src/adapter";
import type { Prompt } from "../src/prompt/prompt-types";

declare const schema: z.ZodType<{ title: string; count: number }, { title: string; count: string }>;
type Out = z.output<typeof schema>;
type In = z.input<typeof schema>;

declare const structured: StreamResult<Out, DeepPartial<In>>;
declare const textOnly: StreamResult;

// The two prompt kinds a managed `stream()` can be given, so the assertions below
// test the DERIVED result types rather than one interface against itself.
type StructuredPrompt = Prompt<z.ZodType, typeof schema, [], undefined>;
type TextPrompt = Prompt<z.ZodType, undefined, [], undefined>;

// ── No bypass surface may exist ───────────────────────────────────
// @ts-expect-error - `raw` is removed: a physical provider stream resolves too early for
// terminal Safety and describes only one attempt.
structured.raw;
// @ts-expect-error - nor may it reappear under another name.
structured.acceptedRaw;
// @ts-expect-error - nor as a provider result.
structured.providerResult;
// @ts-expect-error - nor as an explicit escape hatch.
structured.unsafe;

// ── Operation identity is precise ─────────────────────────────────
const runId: CruxRunId = structured.runId;
void runId;
const meta: OperationResultMeta = structured._meta;
void meta;

// ── The shape is unconditional ────────────────────────────────────
// Not merely "both expose partialOutputStream": the FULL key sets must be equal, so a
// schema gate or execution route can never add or drop a public member.
type Expect<T extends true> = T;
type KeysEqual<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;
// A schema changes the VALUE types and nothing else: the derived results for a
// structured and a text-only prompt must expose exactly the same members.
type _ShapeIsSchemaInvariant = Expect<
  KeysEqual<AdapterStreamResult<StructuredPrompt>, AdapterStreamResult<TextPrompt>>
>;
type _ShapeIsRouteInvariant = Expect<
  KeysEqual<AdapterStreamResult<StructuredPrompt>, typeof structured>
>;

// The native route is typed BY the prompt's schema, exactly like `@use-crux/ai`.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _NativeStructuredOutput = Expect<
  AssertEqual<
    Awaited<AdapterStreamResult<StructuredPrompt>["completion"]>["object"],
    Out | undefined
  >
>;
type _NativeStructuredPartial = Expect<
  AssertEqual<
    AdapterStreamResult<StructuredPrompt>["partialOutputStream"],
    AsyncIterableStream<DeepPartial<In>>
  >
>;
// A text-only prompt has no structured value to describe, so `never` — not
// `unknown`, which would let a caller believe partials might arrive.
type _NativeTextPartial = Expect<
  AssertEqual<
    AdapterStreamResult<TextPrompt>["partialOutputStream"],
    AsyncIterableStream<never>
  >
>;
type _ShapeMatchesContract = Expect<
  KeysEqual<
    typeof structured,
    {
      runId: unknown;
      _meta: unknown;
      textStream: unknown;
      fullStream: unknown;
      partialOutputStream: unknown;
      completion: unknown;
      cancel: unknown;
    }
  >
>;
const textPartials: AsyncIterableStream<never> = textOnly.partialOutputStream;
void textPartials;
const structuredPartials: AsyncIterableStream<DeepPartial<In>> =
  structured.partialOutputStream;
void structuredPartials;

// Surfaces are genuine ReadableStreams that also support `for await`.
const asStream: ReadableStream<string> = structured.textStream;
const asIterable: AsyncIterable<string> = structured.textStream;
void asStream;
void asIterable;

// ── Partials are canonical `z.input`, not `z.output` ──────────────
declare const partial: DeepPartial<In>;
// `count` is `string` on the input side; assigning the output type must fail.
const inputShaped: { count?: string } = partial;
void inputShaped;
// @ts-expect-error - partials are NOT `DeepPartial<z.output<S>>`.
const outputShaped: { count?: number } = partial;
void outputShaped;

// ── `completion.object` is the authored `z.output` ────────────────
async function completionShape(): Promise<void> {
  const facts = await structured.completion;
  const object: Out | undefined = facts.object;
  void object;
  // The canonical envelope is preserved, NOT weakened to `unknown`.
  const runIdentity: CruxRunId = facts.runId;
  const identity: OperationResultMeta = facts._meta;
  const usage: TokenUsage | undefined = facts.usage;
  void runIdentity;
  void identity;
  void usage;
  // @ts-expect-error - a text-only stream has no structured output type.
  const never: string = (await textOnly.completion).object;
  void never;
}
void completionShape;

// ── The event protocol is closed and provider-neutral ─────────────
declare const event: StreamEvent<DeepPartial<In>>;
if (event.type === "text-delta") {
  const text: string = event.text;
  void text;
}
// @ts-expect-error - provider step framing is not public.
const stepFrame: StreamEvent = { type: "start-step" };
void stepFrame;
// @ts-expect-error - physical text framing is not public.
const textFrame: StreamEvent = { type: "text-start", id: "x" };
void textFrame;
// @ts-expect-error - provider error events are not public.
const errorFrame: StreamEvent = { type: "error", error: new Error("x") };
void errorFrame;

// Cancellation is part of the contract.
structured.cancel();
structured.cancel(new Error("caller aborted"));
