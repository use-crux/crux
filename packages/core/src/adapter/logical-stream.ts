/**
 * The managed logical stream contract (RFC #173).
 *
 * `stream()` returns ONE logical Crux stream. A logical stream may use one or more
 * physical provider attempts, but that is never observable through its public shape:
 * physical attempts, provider-step framing, and rejected content are private.
 *
 * "Published" means final with respect to every Safety stage that could still block or
 * rewrite the published value. Adding a guardrail, constraint, validation retry, or
 * provider capability may change documented release timing; it never changes the result
 * type, replaces the result with a provider facade, or makes a bypass surface appear.
 *
 * Core owns these provider-neutral types. Provider packages map their physical stream
 * protocols onto them; core never imports a provider SDK.
 *
 * @module
 */

import type { CruxRunId, OperationResultMeta } from "../observability";
import type { TokenUsage } from "../generation/types";
import type { ContentPart } from "../types/content";
import type { StreamCompletion } from "./stream-result-types";

/** A `ReadableStream` that also supports `for await`. */
export type AsyncIterableStream<T> = ReadableStream<T> & AsyncIterable<T>;

/** Recursively optional projection of an authored input type. */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/** A citation-style source attached to published output. */
export type StreamSource =
  | {
      readonly kind: "url";
      readonly id: string;
      readonly url: string;
      readonly title?: string;
      /** Provider metadata for THIS source; operation-wide metadata is on completion. */
      readonly metadata?: unknown;
    }
  | {
      readonly kind: "document";
      readonly id: string;
      readonly mediaType: string;
      readonly title: string;
      readonly filename?: string;
      readonly metadata?: unknown;
    };

/**
 * One published logical event.
 *
 * @remarks
 * The protocol is closed and provider-neutral. `start` and `finish` describe the ONE
 * logical operation: provider-attempt and provider-step framing is not public, so there
 * is no `start-step`, `finish-step`, physical `text-start`/`text-end`, `raw`, `abort`, or
 * provider error event. A terminal failure errors every live surface and rejects
 * `completion` with the same normalized error identity — it does not emit `finish`.
 *
 * Tool inputs and media are emitted only once structurally complete; unfinished
 * tool-input JSON is never published.
 *
 * @typeParam TPartial - Canonical partial `z.input` projection for a structured prompt.
 */
export type StreamEvent<TPartial = never> =
  | { readonly type: "start" }
  /**
   * Published text. For a STRUCTURED prompt this carries the canonical serialized JSON
   * representation of the accepted `z.input` — never provider wire JSON.
   */
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly text: string }
  | {
      readonly type: "media";
      readonly part: Exclude<ContentPart, { readonly type: "text" }>;
    }
  | {
      readonly type: "tool-call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | {
      readonly type: "tool-result";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly output: unknown;
      readonly isError?: boolean;
    }
  /**
   * The existing tool-approval protocol suspended this logical operation.
   *
   * The stream then finishes normally with `finishReason: 'tool_approval_required'`.
   * Answer by appending the approval-response message and starting a follow-up managed
   * call: there is no interactive response method on the result, and publication never
   * waits for an answer on the same stream.
   */
  | {
      readonly type: "tool-approval-request";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly type: "source"; readonly source: StreamSource }
  | { readonly type: "partial-output"; readonly value: TPartial }
  | {
      readonly type: "finish";
      readonly finishReason?: string;
      /** Logical aggregate usage; see {@link StreamCompletion} usage. */
      readonly usage?: TokenUsage;
    };

/**
 * A logical event a producer may publish.
 *
 * @remarks
 * Excludes `start` and `finish`: those describe the ONE logical operation and are owned
 * by the publication seam, so a producer cannot emit a second `start`, a `finish` before
 * the operation is final, or any event after `finish`.
 */
export type PublishedStreamEvent<TPartial = never> = Exclude<
  StreamEvent<TPartial>,
  { readonly type: "start" } | { readonly type: "finish" }
>;

/**
 * Terminal facts for one managed logical stream.
 *
 * @remarks
 * This is the EXISTING canonical {@link StreamCompletion} envelope, not a parallel
 * contract: the logical result must not weaken `cost`, `steps`, `messages`, or
 * `pendingApprovals` into `unknown`.
 *
 * Logical `usage` and `cost` are scalar aggregates across EVERY billable physical
 * attempt, including rejected ones — aggregate billing is not a publication of rejected
 * output, so they intentionally do not equal the sum of `steps[].usage` when policy
 * retries occurred. If any physical attempt omits usage, logical `usage` is omitted
 * rather than under-reported; likewise for `cost`.
 *
 * `steps`, transcript content, `warnings`, and `providerMetadata` describe only committed
 * logical work from the accepted attempt. Discarded attempts remain visible through
 * internal observability spans, never through this envelope.
 *
 * `object` is the single authored-Zod-validated `z.output`. It stays optional even when
 * `TOutput` is known: an operation that suspends for tool approval finishes without a
 * structured candidate. It is never populated from a provider SDK's own parsed object.
 */
export type { StreamCompletion } from "./stream-result-types";

/**
 * One managed logical stream.
 *
 * @remarks
 * All three streams project one shared append-only logical event log with independent
 * cursors: consuming one never consumes another, they may be read concurrently, and a
 * surface first accessed late replays from logical `start` and then continues live. A
 * surface accessed after terminal failure or cancellation replays the committed prefix
 * and then errors with the same normalized error as every other surface and `completion`.
 *
 * Retention does not delay publication: the operation drives independently of consumers,
 * so `completion` settles without any stream being drained, and one slow or unused
 * surface never backpressures execution or another surface.
 *
 * There is deliberately no `raw`, `acceptedRaw`, `providerResult`, or `unsafe` escape
 * hatch. A physical provider stream resolves too early for terminal Safety and describes
 * only one attempt, so exposing it would reopen the bypass this contract removes.
 * Provider-specific request options remain supported, and provider-specific terminal
 * facts belong in `completion.providerMetadata`.
 *
 * @typeParam TOutput - Final authored-schema `z.output`.
 * @typeParam TPartial - Canonical partial `z.input` projection.
 */
export interface StreamResult<TOutput = never, TPartial = never> {
  /** Authoritative logical run, stable across physical attempts. */
  readonly runId: CruxRunId;
  /** Identity of the owning `generation.stream`, available as soon as `stream()` returns. */
  readonly _meta: OperationResultMeta;
  /** Published, Safety-final text fragments. */
  readonly textStream: AsyncIterableStream<string>;
  /** Every published logical event in canonical order. */
  readonly fullStream: AsyncIterableStream<StreamEvent<TPartial>>;
  /**
   * Canonical structured progress.
   *
   * @remarks
   * Values are `DeepPartial<z.input<S>>` — manifest-decoded canonical input carrying no
   * provider lowering sentinel — never provider wire values and never
   * `DeepPartial<z.output<S>>`. They publish only once the selected occurrence is
   * release-ready and grow monotonically. A rejected attempt contributes nothing. While
   * validation retry is an unresolved whole-attempt gate nothing publishes here; accepted
   * partials may then release as a burst.
   *
   * For a text-only prompt this stream yields no values and closes when the operation
   * settles, so the result shape stays unconditional and discoverable. It closes with
   * the rest of the stream rather than before it, so draining it first is safe but is
   * not a way to observe completion early.
   */
  readonly partialOutputStream: AsyncIterableStream<TPartial>;
  /** Final validated output, transcript, logical usage, cost, and metadata. */
  readonly completion: Promise<StreamCompletion<TOutput>>;
  /**
   * Abort the whole logical operation, including the active physical attempt.
   *
   * Prevents another retry and rejects every current and future surface plus
   * `completion` with the same normalized abort, after replaying any already committed
   * prefix. Uncommitted candidate buffers are released immediately; the committed replay
   * log is retained while the result remains reachable. Returning early from one surface
   * detaches only that reader. The caller's `AbortSignal` has the same authority.
   */
  cancel(reason?: unknown): void;
}
