/**
 *
 * Judge-backed RAG scorers (RAGAS-style): faithfulness, answer relevancy,
 * context precision, context recall.
 *
 * Retrieved context comes from the cell's captured retrieval signals (the
 * `retrieval.hits` artifact previews) when the task's trace produced them,
 * else from a `context` field on the case input (`string | string[]`).
 * Without any context, context-dependent scorers skip honestly with
 * `score: null` and a `metadata.reason` — they never guess.
 *
 * @internal
 * @module
 */

import { judge as createJudge } from '../../../scoring'
import type { JudgeInput } from '../../../scoring'
import { asJudgeText, bridgeGenerateForJudge, resolveJudgeModel } from './judge'
import type { ContextualScorerRun, ScorerRunContext } from './runtime'
import type { Score, ScorerArgs } from './types'
import type { GenerateFn } from '../capabilities'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Pull retrieved context chunks: captured retrieval hits first, then `input.context`. */
function retrievedContextChunks(
  args: ScorerArgs<unknown, unknown, unknown>,
  context: ScorerRunContext | undefined,
): string[] | undefined {
  const fromSignals = (context?.signals?.retrievalHits ?? [])
    .map((hit) => {
      if (typeof hit.preview === 'string') return hit.preview
      if (typeof hit.text === 'string') return hit.text
      if (typeof hit.content === 'string') return hit.content
      return undefined
    })
    .filter((chunk): chunk is string => chunk !== undefined)
  if (fromSignals.length > 0) return fromSignals

  if (isRecord(args.input)) {
    const declared = args.input.context
    if (typeof declared === 'string') return [declared]
    if (Array.isArray(declared) && declared.every((chunk) => typeof chunk === 'string')) {
      return declared as string[]
    }
  }
  return undefined
}

/** The question a RAG case asked: `input.query`/`input.question`, else the input as text. */
function questionText(input: unknown): string {
  if (isRecord(input)) {
    if (typeof input.query === 'string') return input.query
    if (typeof input.question === 'string') return input.question
  }
  return asJudgeText(input)
}

export type RagScorerKind = 'faithfulness' | 'answerRelevancy' | 'contextPrecision' | 'contextRecall'

const RAG_CRITERIA: Record<RagScorerKind, string> = {
  faithfulness:
    'Is every claim in the output supported by the retrieved context provided above? ' +
    'Score 1 when all claims are grounded in the context, 0 when the output contradicts or invents facts, ' +
    'proportionally in between.',
  answerRelevancy:
    'Does the output actually address the question asked in the input? ' +
    'Score 1 for a direct, complete answer, 0 for an off-topic or evasive one.',
  contextPrecision:
    'The output is a list of retrieved context chunks. Are they relevant to the question in the input? ' +
    'Score the fraction of chunks that genuinely help answer it.',
  contextRecall:
    'The output is a list of retrieved context chunks. Does it contain all the information the reference ' +
    'answer needs? Score 1 when every fact in the reference is covered by the chunks, 0 when none are.',
}

/** Which inputs each RAG scorer requires before it can judge anything. */
const NEEDS_CONTEXT: Record<RagScorerKind, boolean> = {
  faithfulness: true,
  answerRelevancy: false,
  contextPrecision: true,
  contextRecall: true,
}

export interface RagScorerOptions {
  name?: string
  generate?: GenerateFn
  model?: unknown
  useCoT?: boolean
}

/** Build the contextual run implementation behind a `scorers.rag.*` factory. */
export function createRagScorerRun(kind: RagScorerKind, opts: RagScorerOptions): ContextualScorerRun {
  const name = opts.name ?? kind
  return async (args, context): Promise<Score> => {
    const chunks = NEEDS_CONTEXT[kind] ? retrievedContextChunks(args, context) : undefined
    if (NEEDS_CONTEXT[kind] && chunks === undefined) {
      return {
        name,
        score: null,
        metadata: {
          reason:
            'no retrieved context available — the task captured no retrieval signals and the case input has no `context` field',
        },
      }
    }
    if (kind === 'contextRecall' && args.expected === undefined) {
      return {
        name,
        score: null,
        metadata: { reason: 'contextRecall needs an `expected` reference answer on the case' },
      }
    }

    const { generate, model } = resolveJudgeModel(
      { generate: opts.generate, model: opts.model },
      context,
      `scorers.rag.${kind}('${name}')`,
    )
    const judgesChunks = kind === 'contextPrecision' || kind === 'contextRecall'
    const judge = createJudge({
      id: name,
      criteria: RAG_CRITERIA[kind],
      scale: { min: 0, max: 1 },
      chainOfThought: opts.useCoT ?? true,
      // Faithfulness grades the answer AGAINST the chunks, so they ride as
      // judge context; precision/recall grade the chunks themselves.
      ...(kind === 'faithfulness' ? { context: `Retrieved context:\n${chunks!.join('\n---\n')}` } : {}),
    })

    const judgeInput: JudgeInput = {
      input: questionText(args.input),
      output: judgesChunks ? chunks!.join('\n---\n') : asJudgeText(args.output),
      ...(kind === 'contextRecall' ? { reference: asJudgeText(args.expected) } : {}),
    }
    const result = await judge.score(judgeInput, { generate: bridgeGenerateForJudge(generate), model })
    return { name, score: result.score, metadata: { rationale: result.reasoning } }
  }
}
