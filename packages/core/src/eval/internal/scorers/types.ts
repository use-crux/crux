/**
 *
 * Scorers — autoevals-compatible scoring functions and the built-in library.
 *
 * Any `({ input, output, expected }) => Score` function is a scorer; autoevals
 * scorers plug in unchanged. Crux built-ins additionally carry a literal
 * `scorerName` (linking gate keys at compile time) and a `costClass` so the
 * reporter can show what costs tokens.
 *
 * Code-class scorers (`exact`, `contains`, `regex`, `levenshtein`,
 * `jsonValid`, `jsonDiff`, `retrieval.*`) run locally for free. Model-backed
 * scorers (`judge`, `embeddingSimilarity`, `rag.*`) require explicit live
 * bindings where they need them. Keep model, generate, and embedder choices
 * in eval code or eval-local helper modules so the token-spending path is
 * visible where the scorer is authored.
 *
 * @module
 */

import { canonicalJson } from "../evidence/canonical-json";
import { JUDGE_PROMPT_VERSION } from "../evidence/cache-epochs";
import { fingerprintPortableValue } from "../evidence/portable-fingerprint";
import {
  SCORER_IDENTITY,
  SCORER_INTERNAL,
  type ContextualScorerRun,
} from "./runtime";
import { runJudgeScorer } from "./judge";
import { createRagScorerRun } from "./rag";
import {
  ragCitationValidity,
  ragContextPrecision,
  ragExpectedSourceCoverage,
  ragMrr,
  ragRecallAtK,
  ragTraceShapeSnapshot,
  type RagContextPrecisionOptions,
  type RagMetricOptions,
} from "./rag-metrics";
import { MissingEvalModelBindingError } from "./errors";
import type { GenerateFn, ModelRef } from "../capabilities";
import type { Asset } from "../../../asset";
import type { ContentPart } from "../../../types/content";

// ─────────────────────────────────────────────────────────────────
// Core contracts
// ─────────────────────────────────────────────────────────────────

/** What every scorer receives for one executed cell. */
export interface ScorerArgs<I, O, E> {
  input: I;
  output: O;
  expected: E | undefined;
}

/**
 * Autoevals-compatible scoring result. `label` covers categorical/text
 * scorers; judge rationale lives in `metadata`.
 */
export interface Score {
  name: string;
  /** 0–1, or `null` when the scorer was skipped / not applicable. */
  score: number | null;
  /** Categorical outcome for classification-style scorers. */
  label?: string;
  /** Free-form diagnostics; judge rationale lives here. */
  metadata?: Record<string, unknown>;
}

/** Content that may be supplied directly to the existing model judge. */
export type JudgeContent = string | Asset | readonly ContentPart[];

/**
 * A scoring function. Any `({ input, output, expected }) => Score` works —
 * autoevals plugs in unchanged. `scorerName` is present on Crux built-ins and
 * enables literal gate-name linkage; `costClass` drives cost display.
 *
 * @typeParam I - Case input type.
 * @typeParam O - Task output type.
 * @typeParam E - Expected payload type.
 * @typeParam N - Literal score name (degrades to `string` for plain fns).
 */
export type Scorer<I, O, E, N extends string = string> = ((
  args: ScorerArgs<I, O, E>,
) => Score | Promise<Score>) & {
  /** Present on Crux built-ins; enables literal gate-name linkage + cost display. */
  scorerName?: N;
  /** `'code'` runs locally for free; `'model'` spends tokens. */
  costClass?: "code" | "model";
};

/**
 * The factory-lambda spelling of `scorers:` — receives the built-in library
 * pre-bound to the evaluation's generics, so `judge.select` is typed
 * `(output: TOutput) => string` contextually. Taught for structured outputs;
 * the plain array stays the documented default.
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportPrompt, // structured output
 *   data: cases,
 *   scorers: (s) => [s.judge({ name: 'helpful', rubric: '…', select: (o) => o.answer })],
 * })
 * ```
 */
export type ScorerFactory<I, O, E> = (
  s: BoundScorerLib<I, O, E>,
) => ReadonlyArray<Scorer<I, O, E, string>>;

// ─────────────────────────────────────────────────────────────────
// Built-in option shapes
// ─────────────────────────────────────────────────────────────────

/**
 * Embedding function bridge for `embeddingSimilarity`: maps texts to vectors.
 * Pass this explicitly for embedding-backed scorers.
 */
export type EmbedFn = (
  texts: readonly string[],
) => Promise<ReadonlyArray<ReadonlyArray<number>>>;

/** Options shared by the judge-backed RAG scorers. */
export interface JudgeBacked {
  /** Score name override. */
  name?: string;
  /** Adapter generate function supplied by the eval or an eval-local helper. */
  generate?: GenerateFn;
  /** Judge model supplied by the eval or an eval-local helper. */
  model?: ModelRef;
  /** Concise explanation before verdict. Default true. */
  useCoT?: boolean;
}

/** The non-conditional half of `scorers.judge()` options. */
export interface JudgeOptionsBase<N extends string> {
  /** Score name — flows into gate keys as a literal type. */
  name: N;
  /** Free-rubric grading (0–1). Mutually exclusive with `choiceScores`. */
  rubric?: string;
  /** Classification with mapped scores. Mutually exclusive with `rubric`. */
  choiceScores?: Record<string, number>;
  /** Adapter generate function supplied by the eval or an eval-local helper. */
  generate?: GenerateFn;
  /** Judge model supplied by the eval or an eval-local helper. */
  model?: ModelRef;
  /** Concise explanation before verdict. Default true. Rationale → metadata. */
  useCoT?: boolean;
}

/**
 * The `select` requirement: optional for string outputs, REQUIRED for
 * structured outputs (a judge needs text — without a typed selector,
 * structured-output evaluations using text judges are a compile error, not
 * silently stringified JSON). @internal
 */
export type JudgeSelect<O> = [O] extends [JudgeContent]
  ? { select?: (output: O) => JudgeContent }
  : { select: (output: O) => JudgeContent };

// ─────────────────────────────────────────────────────────────────
// Library interfaces (standalone + evaluation-bound)
// ─────────────────────────────────────────────────────────────────

/**
 * The built-in scorer library, generics unbound (standalone import form).
 * `judge` defaults its output type to `string`; for structured outputs,
 * either annotate `select` or use the factory-lambda spelling of `scorers:`
 * to get the pre-bound library.
 */
export interface ScorerLibrary {
  /**
   * LLM-as-judge scorer: free-rubric grading or classification with mapped
   * scores. Chain-of-thought is on by default; the rationale is recorded in
   * the score's `metadata`.
   *
   * @example
   * ```ts
   * scorers.judge({ name: 'helpful', rubric: 'Does the answer resolve the question?' })
   * scorers.judge({ name: 'tone', choiceScores: { formal: 1, casual: 0.5, rude: 0 } })
   * ```
   */
  judge<const N extends string, O = string>(
    opts: JudgeOptionsBase<N> & JudgeSelect<O>,
  ): Scorer<unknown, O, unknown, N>;

  /**
   * Exact match against `expected` (canonical-JSON equality for structured
   * values). Returns `null` when the case has no `expected`.
   */
  exact<const N extends string = "exact">(opts?: {
    name?: N;
  }): Scorer<unknown, unknown, unknown, N>;

  /**
   * Substring presence. The needle is `value` when given, else the case's
   * `expected` (string cases). Returns `null` without a needle.
   */
  contains(opts?: {
    name?: string;
    value?: string;
  }): Scorer<unknown, unknown, unknown, string>;

  /** Regex test over the output text. */
  regex(opts: {
    name?: string;
    pattern: RegExp;
  }): Scorer<unknown, unknown, unknown, string>;

  /**
   * Normalized Levenshtein similarity (0–1) between string output and string
   * `expected`. Returns `null` for non-string pairs.
   */
  levenshtein(opts?: {
    name?: string;
  }): Scorer<unknown, unknown, unknown, string>;

  /** 1 when the output is valid JSON (string outputs are parsed; structured outputs pass). */
  jsonValid(opts?: {
    name?: string;
  }): Scorer<unknown, unknown, unknown, string>;

  /**
   * Structural JSON similarity (0–1) between output and `expected`: recursive
   * key/element comparison with string-leaf Levenshtein and numeric-distance
   * partial credit. Returns `null` when the case has no `expected`.
   */
  jsonDiff(opts?: { name?: string }): Scorer<unknown, unknown, unknown, string>;

  /** Cosine similarity between output and `expected` embeddings. Model-backed. */
  embeddingSimilarity(opts?: {
    name?: string;
    embed?: EmbedFn;
  }): Scorer<unknown, unknown, unknown, string>;

  /**
   * Retrieval-grounded RAG quality scorers.
   *
   * The beta metrics (`recallAtK`, `mrr`, `expectedSourceCoverage`,
   * `contextPrecision`, `citationValidity`, and `traceShapeSnapshot`) are
   * deterministic code scorers. For model-judged answer relevance or
   * groundedness, use `scorers.judge()` or the generic judge-backed helpers
   * below with an eval-local `generate`/`model`; provider-specific judges stay
   * outside `@use-crux/core`.
   */
  rag: {
    /** Recall over expected sources in the first `k` retrieved hits. */
    recallAtK(
      k: number,
    ): Scorer<unknown, unknown, unknown, `rag.recall@${number}`>;
    /** Mean reciprocal rank of the first expected source. */
    mrr<const N extends string = "rag.mrr">(
      opts?: RagMetricOptions<N>,
    ): Scorer<unknown, unknown, unknown, N>;
    /** Fraction of expected sources retrieved anywhere in the result set. */
    expectedSourceCoverage<
      const N extends string = "rag.expectedSourceCoverage",
    >(
      opts?: RagMetricOptions<N>,
    ): Scorer<unknown, unknown, unknown, N>;
    /** Fraction of returned contexts that match expected source identity. */
    contextPrecision<const N extends string = "rag.contextPrecision">(
      opts?: RagContextPrecisionOptions<N>,
    ): Scorer<unknown, unknown, unknown, N>;
    /** Fraction of cited sources that are grounded and match expected sources when provided. */
    citationValidity<const N extends string = "rag.citationValidity">(
      opts?: RagMetricOptions<N>,
    ): Scorer<unknown, unknown, unknown, N>;
    /** Validates the serializable recipe trace shape used for snapshot-style evals. */
    traceShapeSnapshot<const N extends string = "rag.traceShapeSnapshot">(
      opts?: RagMetricOptions<N>,
    ): Scorer<unknown, unknown, unknown, N>;
    /** Is every claim in the answer supported by the retrieved context? */
    faithfulness(opts?: JudgeBacked): Scorer<unknown, unknown, unknown, string>;
    /** Does the answer address the question? */
    answerRelevancy(
      opts?: JudgeBacked,
    ): Scorer<unknown, unknown, unknown, string>;
    /** Did retrieval surface everything the reference answer needs? */
    contextRecall(
      opts?: JudgeBacked,
    ): Scorer<unknown, unknown, unknown, string>;
  };

  /**
   * Pure-code retrieval metrics. Cases must carry an `expected` of shape
   * `{ sources: Array<{ sourceId: string; chunkId?: string }> }` (validated
   * at run time).
   */
  retrieval: {
    /** Fraction of cases with ≥1 expected source in the top k. */
    hitRateAtK(k: number): Scorer<unknown, unknown, unknown, string>;
    /** Fraction of expected sources present in the top k. */
    recallAtK(k: number): Scorer<unknown, unknown, unknown, string>;
    /** Fraction of the top k that are expected sources. */
    precisionAtK(k: number): Scorer<unknown, unknown, unknown, string>;
    /** Mean reciprocal rank of the first expected source. */
    mrr(): Scorer<unknown, unknown, unknown, string>;
    /** Normalized discounted cumulative gain at k. */
    ndcg(k?: number): Scorer<unknown, unknown, unknown, string>;
  };
}

/**
 * The built-in library pre-bound to an evaluation's generics — what the
 * factory-lambda spelling of `scorers:` receives. Identical runtime object;
 * the binding is purely type-level (`judge.select` becomes
 * `(output: TOutput) => string` contextually).
 *
 * @typeParam I - Case input type.
 * @typeParam O - Task output type.
 * @typeParam E - Expected payload type.
 */
export interface BoundScorerLib<I, O, E> {
  judge<const N extends string>(
    opts: JudgeOptionsBase<N> & JudgeSelect<O>,
  ): Scorer<I, O, E, N>;
  exact<const N extends string = "exact">(opts?: {
    name?: N;
  }): Scorer<I, O, E, N>;
  contains(opts?: { name?: string; value?: string }): Scorer<I, O, E, string>;
  regex(opts: { name?: string; pattern: RegExp }): Scorer<I, O, E, string>;
  levenshtein(opts?: { name?: string }): Scorer<I, O, E, string>;
  jsonValid(opts?: { name?: string }): Scorer<I, O, E, string>;
  jsonDiff(opts?: { name?: string }): Scorer<I, O, E, string>;
  embeddingSimilarity(opts?: {
    name?: string;
    embed?: EmbedFn;
  }): Scorer<I, O, E, string>;
  /**
   * Retrieval-grounded RAG quality scorers. Deterministic metrics are
   * code-class; model-judged hooks require explicit eval-local bindings.
   */
  rag: {
    recallAtK(k: number): Scorer<I, O, E, `rag.recall@${number}`>;
    mrr<const N extends string = "rag.mrr">(
      opts?: RagMetricOptions<N>,
    ): Scorer<I, O, E, N>;
    expectedSourceCoverage<
      const N extends string = "rag.expectedSourceCoverage",
    >(
      opts?: RagMetricOptions<N>,
    ): Scorer<I, O, E, N>;
    contextPrecision<const N extends string = "rag.contextPrecision">(
      opts?: RagContextPrecisionOptions<N>,
    ): Scorer<I, O, E, N>;
    citationValidity<const N extends string = "rag.citationValidity">(
      opts?: RagMetricOptions<N>,
    ): Scorer<I, O, E, N>;
    traceShapeSnapshot<const N extends string = "rag.traceShapeSnapshot">(
      opts?: RagMetricOptions<N>,
    ): Scorer<I, O, E, N>;
    faithfulness(opts?: JudgeBacked): Scorer<I, O, E, string>;
    answerRelevancy(opts?: JudgeBacked): Scorer<I, O, E, string>;
    contextRecall(opts?: JudgeBacked): Scorer<I, O, E, string>;
  };
  retrieval: {
    hitRateAtK(k: number): Scorer<I, O, E, string>;
    recallAtK(k: number): Scorer<I, O, E, string>;
    precisionAtK(k: number): Scorer<I, O, E, string>;
    mrr(): Scorer<I, O, E, string>;
    ndcg(k?: number): Scorer<I, O, E, string>;
  };
}

// ─────────────────────────────────────────────────────────────────
// Implementation helpers
// ─────────────────────────────────────────────────────────────────

type AnyScorerFn = (
  args: ScorerArgs<unknown, unknown, unknown>,
) => Score | Promise<Score>;

function makeScorer<N extends string>(
  name: N,
  costClass: "code" | "model",
  fn: AnyScorerFn,
): Scorer<unknown, unknown, unknown, N> {
  return Object.assign(fn, { scorerName: name, costClass });
}

/**
 * Build a model-backed built-in: the plain callable delegates to the
 * contextual run with no context (standalone/autoevals path), while the
 * engine invokes the {@link SCORER_INTERNAL} form with ambient providers.
 */
function makeContextualScorer<N extends string>(
  name: N,
  run: ContextualScorerRun,
): Scorer<unknown, unknown, unknown, N> {
  const plain: AnyScorerFn = (args) => run(args, undefined);
  return Object.assign(plain, {
    scorerName: name,
    costClass: "model" as const,
    [SCORER_INTERNAL]: run,
  });
}

function outputText(output: unknown): string {
  return typeof output === "string" ? output : canonicalJson(output);
}

/** Two-row Levenshtein distance. @internal exported for engine reuse. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        substitution,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length]!;
}

function stringSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshteinDistance(a, b) / max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Cosine similarity clamped to 0–1 (negative similarity floors at 0). */
function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

/** Recursive structural similarity used by `jsonDiff`. @internal */
export function jsonSimilarity(actual: unknown, expected: unknown): number {
  if (actual === expected) return 1;
  if (typeof actual === "number" && typeof expected === "number") {
    const max = Math.max(Math.abs(actual), Math.abs(expected));
    return max === 0 ? 1 : Math.max(0, 1 - Math.abs(actual - expected) / max);
  }
  if (typeof actual === "string" && typeof expected === "string") {
    return stringSimilarity(actual, expected);
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const length = Math.max(actual.length, expected.length);
    if (length === 0) return 1;
    let total = 0;
    for (let i = 0; i < length; i++) {
      total +=
        i < actual.length && i < expected.length
          ? jsonSimilarity(actual[i], expected[i])
          : 0;
    }
    return total / length;
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    if (keys.size === 0) return 1;
    let total = 0;
    for (const key of keys) {
      total +=
        key in actual && key in expected
          ? jsonSimilarity(actual[key], expected[key])
          : 0;
    }
    return total / keys.size;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────
// The library
// ─────────────────────────────────────────────────────────────────

function judgeScorer(
  opts: JudgeOptionsBase<string> & { select?: (output: never) => JudgeContent },
): AnyScorerFn & {
  scorerName?: string;
  costClass?: "code" | "model";
} {
  if ((opts.rubric === undefined) === (opts.choiceScores === undefined)) {
    throw new TypeError(
      "scorers.judge(): provide exactly one of `rubric` or `choiceScores`.",
    );
  }
  if (
    opts.choiceScores !== undefined &&
    Object.keys(opts.choiceScores).length === 0
  ) {
    throw new TypeError(
      "scorers.judge(): `choiceScores` must declare at least one choice.",
    );
  }
  return Object.assign(
    makeContextualScorer(opts.name, (args, context) =>
      runJudgeScorer(opts, args, context),
    ),
    {
      [SCORER_IDENTITY]: {
        kind: "judge",
        name: opts.name,
        judge: judgeIdentity(opts),
        rubric: opts.rubric,
        choiceScores: opts.choiceScores,
        model: opts.model,
        generate: opts.generate,
        useCoT: opts.useCoT,
        select: opts.select,
      },
    },
  );
}

function judgeIdentity(
  opts: JudgeOptionsBase<string>,
): Record<string, unknown> {
  return {
    ...(opts.model !== undefined ? { model: modelLabel(opts.model) } : {}),
    promptVersion: JUDGE_PROMPT_VERSION,
    rubricFingerprint: fingerprintPortableValue({
      rubric: opts.rubric ?? null,
      choiceScores: opts.choiceScores ?? null,
    }),
  };
}

function modelLabel(model: unknown): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const record = model as Record<string, unknown>;
    if (typeof record.modelId === "string") return record.modelId;
    if (typeof record.id === "string") return record.id;
    if (typeof record.model === "string") return record.model;
  }
  return String(model);
}

/**
 * The built-in scorer library.
 *
 * The Eval authoring factory binds this library to the task's input, output,
 * and expected-value types.
 */
export const scorers: ScorerLibrary = {
  judge: judgeScorer as ScorerLibrary["judge"],

  exact(opts) {
    const name =
      opts?.name ?? ("exact" as NonNullable<typeof opts>["name"] & string);
    return makeScorer(name, "code", ({ output, expected }) => {
      if (expected === undefined) return { name, score: null };
      return {
        name,
        score: canonicalJson(output) === canonicalJson(expected) ? 1 : 0,
      };
    });
  },

  contains(opts) {
    const name = opts?.name ?? "contains";
    return makeScorer(name, "code", ({ output, expected }) => {
      const needle =
        opts?.value ?? (typeof expected === "string" ? expected : undefined);
      if (needle === undefined) return { name, score: null };
      return { name, score: outputText(output).includes(needle) ? 1 : 0 };
    });
  },

  regex(opts) {
    const name = opts.name ?? "regex";
    const pattern = opts.pattern;
    return makeScorer(name, "code", ({ output }) => {
      // Reset lastIndex so global/sticky patterns behave statelessly per cell.
      pattern.lastIndex = 0;
      return { name, score: pattern.test(outputText(output)) ? 1 : 0 };
    });
  },

  levenshtein(opts) {
    const name = opts?.name ?? "levenshtein";
    return makeScorer(name, "code", ({ output, expected }) => {
      if (typeof output !== "string" || typeof expected !== "string")
        return { name, score: null };
      return { name, score: stringSimilarity(output, expected) };
    });
  },

  jsonValid(opts) {
    const name = opts?.name ?? "jsonValid";
    return makeScorer(name, "code", ({ output }) => {
      if (output === undefined) return { name, score: 0 };
      if (typeof output !== "string") return { name, score: 1 };
      try {
        JSON.parse(output);
        return { name, score: 1 };
      } catch {
        return { name, score: 0 };
      }
    });
  },

  jsonDiff(opts) {
    const name = opts?.name ?? "jsonDiff";
    return makeScorer(name, "code", ({ output, expected }) => {
      if (expected === undefined) return { name, score: null };
      const actual = typeof output === "string" ? tryParse(output) : output;
      return { name, score: jsonSimilarity(actual, expected) };
    });
  },

  embeddingSimilarity(opts) {
    const name = opts?.name ?? "embeddingSimilarity";
    return makeContextualScorer(name, async ({ output, expected }, context) => {
      if (expected === undefined) return { name, score: null };
      const embed = opts?.embed ?? context?.embed;
      if (embed === undefined) {
        throw new MissingEvalModelBindingError(
          `scorers.embeddingSimilarity('${name}') needs an embed fn — pass \`embed\` from the eval or an eval-local helper.`,
        );
      }
      const [outputVector, expectedVector] = await embed([
        outputText(output),
        outputText(expected),
      ]);
      if (outputVector === undefined || expectedVector === undefined) {
        throw new Error(
          `scorers.embeddingSimilarity('${name}'): embed fn returned fewer vectors than texts.`,
        );
      }
      return { name, score: cosineSimilarity(outputVector, expectedVector) };
    });
  },

  rag: {
    recallAtK: ragRecallAtK,
    mrr: ragMrr,
    expectedSourceCoverage: ragExpectedSourceCoverage,
    contextPrecision: ragContextPrecision,
    citationValidity: ragCitationValidity,
    traceShapeSnapshot: ragTraceShapeSnapshot,
    faithfulness: (opts) =>
      makeContextualScorer(
        opts?.name ?? "faithfulness",
        createRagScorerRun("faithfulness", opts ?? {}),
      ),
    answerRelevancy: (opts) =>
      makeContextualScorer(
        opts?.name ?? "answerRelevancy",
        createRagScorerRun("answerRelevancy", opts ?? {}),
      ),
    contextRecall: (opts) =>
      makeContextualScorer(
        opts?.name ?? "contextRecall",
        createRagScorerRun("contextRecall", opts ?? {}),
      ),
  },

  retrieval: {
    hitRateAtK: (k) =>
      retrievalScorer(`hitRate@${k}`, (hits, sources) =>
        hits
          .slice(0, k)
          .some((hit) => sources.some((source) => hitMatches(hit, source)))
          ? 1
          : 0,
      ),
    recallAtK: (k) =>
      retrievalScorer(`recall@${k}`, (hits, sources) => {
        const topK = hits.slice(0, k);
        const found = sources.filter((source) =>
          topK.some((hit) => hitMatches(hit, source)),
        );
        return found.length / sources.length;
      }),
    precisionAtK: (k) =>
      retrievalScorer(`precision@${k}`, (hits, sources) => {
        const matched = hits
          .slice(0, k)
          .filter((hit) => sources.some((source) => hitMatches(hit, source)));
        return matched.length / k;
      }),
    mrr: () =>
      retrievalScorer("mrr", (hits, sources) => {
        const index = hits.findIndex((hit) =>
          sources.some((source) => hitMatches(hit, source)),
        );
        return index === -1 ? 0 : 1 / (index + 1);
      }),
    ndcg: (k) =>
      retrievalScorer(
        k === undefined ? "ndcg" : `ndcg@${k}`,
        (hits, sources) => {
          const depth = k ?? hits.length;
          const gains = hits
            .slice(0, depth)
            .map((hit) =>
              sources.some((source) => hitMatches(hit, source)) ? 1 : 0,
            );
          const dcg = gains.reduce(
            (total: number, gain, index) => total + gain / Math.log2(index + 2),
            0,
          );
          const idealOnes = Math.min(sources.length, depth);
          let idcg = 0;
          for (let index = 0; index < idealOnes; index++)
            idcg += 1 / Math.log2(index + 2);
          return idcg === 0 ? 0 : dcg / idcg;
        },
      ),
  },
};

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─────────────────────────────────────────────────────────────────
// Retrieval metrics (pure code)
// ─────────────────────────────────────────────────────────────────

/** The validated `expected` shape retrieval scorers require. */
interface ExpectedSource {
  sourceId: string;
  chunkId?: string;
}

/** A ranked retrieval hit, from the task output or captured retrieval signals. */
interface RankedHit {
  source?: { id?: string };
  chunkId?: string;
  rank?: number;
}

function isExpectedSource(value: unknown): value is ExpectedSource {
  return (
    isPlainObject(value) &&
    typeof value.sourceId === "string" &&
    (value.chunkId === undefined || typeof value.chunkId === "string")
  );
}

function parseExpectedSources(
  expected: unknown,
  name: string,
): ExpectedSource[] {
  if (
    isPlainObject(expected) &&
    Array.isArray(expected.sources) &&
    expected.sources.length > 0 &&
    expected.sources.every(isExpectedSource)
  ) {
    return expected.sources;
  }
  throw new TypeError(
    `scorers.retrieval ('${name}'): \`expected\` must be \`{ sources: Array<{ sourceId: string; chunkId?: string }> }\` with at least one source.`,
  );
}

/**
 * Derive the ranked hit list a retrieval scorer measures: the task output
 * when it is hit-shaped (an array of `{ source: { id } }` records, or `{ hits }`),
 * sorted by `rank` when every entry carries one.
 */
function rankedHitsFromOutput(output: unknown): RankedHit[] | undefined {
  const list = Array.isArray(output)
    ? output
    : isPlainObject(output) && Array.isArray(output.hits)
      ? output.hits
      : undefined;
  if (list === undefined || !list.every(isPlainObject)) return undefined;
  const hits = list as RankedHit[];
  if (hits.length > 1 && hits.every((hit) => typeof hit.rank === "number")) {
    return [...hits].sort((a, b) => (a.rank as number) - (b.rank as number));
  }
  return hits;
}

function hitMatches(hit: RankedHit, source: ExpectedSource): boolean {
  return (
    hit.source?.id === source.sourceId &&
    (source.chunkId === undefined || hit.chunkId === source.chunkId)
  );
}

/**
 * Wrap a retrieval metric: validates `expected`, extracts the ranked hits,
 * and degrades honestly (`null` without `expected` or without a measurable
 * hit list).
 */
function retrievalScorer<N extends string>(
  name: N,
  metric: (
    hits: readonly RankedHit[],
    sources: readonly ExpectedSource[],
  ) => number,
): Scorer<unknown, unknown, unknown, N> {
  return makeScorer(name, "code", ({ output, expected }) => {
    if (expected === undefined) return { name, score: null };
    const sources = parseExpectedSources(expected, name);
    const hits = rankedHitsFromOutput(output);
    if (hits === undefined) {
      return {
        name,
        score: null,
        metadata: {
          reason:
            "output is not a ranked hit list (expected an array of { source: { id } } or { hits })",
        },
      };
    }
    return { name, score: metric(hits, sources) };
  });
}

/**
 * The library handed to factory-lambda `scorers:` — the same runtime object,
 * re-typed against the evaluation's generics. @internal
 */
export function boundScorerLib<I, O, E>(): BoundScorerLib<I, O, E> {
  return scorers as unknown as BoundScorerLib<I, O, E>;
}
