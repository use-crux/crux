/**
 * Handoff — structured context transfer between agents.
 *
 * Validates, transforms, and optionally summarizes context when one agent
 * hands off to another. The receiving agent gets a clean, schema-validated
 * payload via `asContext()`.
 *
 * Supports two modes:
 * - **Stateless**: Use `prepare()` + `asContext()` for in-process handoffs.
 * - **Stored**: Provide `records` to enable `send()` / `receive()` for
 *   distributed agents that run in separate processes or actions.
 *
 * @module
 */

import { z } from 'zod'
import type { JsonObject, RecordStore } from '../storage'
import type { Context } from '../prompt/context-types'
import { contextWithFamily } from '../prompt/context'
import type { GenerateTextFn } from '../compaction/types'
import { getRuntime } from '../runtime/runtime'
import { observe } from '../observability'

// ── Types ───────────────────────────────────────────────────────────

/** Configuration for `handoff()`. */
export interface HandoffConfig<TInput extends z.ZodType, TOutput extends z.ZodType> {
  /** Unique identifier for this handoff definition. */
  id: string
  /** Schema for what the sending agent provides. */
  inputSchema: TInput
  /** Schema for what the receiving agent needs. */
  outputSchema: TOutput
  /** Transform function: maps validated input to output. May be async. */
  transform: (input: z.infer<TInput>) => z.infer<TOutput> | Promise<z.infer<TOutput>>
  /** Optional LLM-powered summary step. */
  summarize?: {
    /** SDK-agnostic text generation function. */
    generate: GenerateTextFn
    /** The model to use for summarization. */
    model: unknown
    /** System prompt for the summarizer. */
    system?: string
  }
  /**
   * Optional record store for persistence. When set, enables `send()` and `receive()`.
   * Use this for distributed agents that run in separate processes or actions.
   */
  records?: RecordStore
  /** Optional callback fired after prepare() completes (for devtools wiring). */
  onPrepare?: (handoffId: string, inputSize: number, outputSize: number) => void
  /** Name of the sending agent (for devtools identification). */
  fromAgent?: string
  /** Name of the receiving agent (for devtools identification). */
  toAgent?: string
}

/** The payload produced by prepare(), ready for the receiving agent. */
export interface HandoffPayload<TOutput> {
  /** The handoff definition id. */
  handoffId: string
  /** Transformed data for the receiving agent. */
  data: TOutput
  /** LLM-generated summary, if summarize was configured. */
  summary?: string
  /** When this payload was created. */
  createdAt: Date
}

/** A handoff instance with prepare() and asContext(). */
export interface HandoffInstance<TInput extends z.ZodType, TOutput extends z.ZodType> {
  /** The unique identifier for this handoff. */
  readonly id: string
  /** The input schema. */
  readonly inputSchema: TInput
  /** The output schema. */
  readonly outputSchema: TOutput

  /**
   * Validate input, run transform, optionally summarize.
   * Returns a HandoffPayload ready for the receiving agent.
   */
  prepare(input: z.infer<TInput>): Promise<HandoffPayload<z.infer<TOutput>>>

  /**
   * Validate input, transform, optionally summarize, and persist to records.
   * Requires `records` to be configured. Throws if no record store is set.
   */
  send(input: z.infer<TInput>): Promise<HandoffPayload<z.infer<TOutput>>>

  /**
   * Read the latest payload from records.
   * Requires `records` to be configured. Throws if no record store is set.
   * Returns null if no payload has been sent yet.
   */
  receive(): Promise<HandoffPayload<z.infer<TOutput>> | null>

  /**
   * Create a Context that injects a prepared payload into a prompt.
   * Takes the payload as argument since handoffs have no backing store.
   */
  asContext(payload: HandoffPayload<z.infer<TOutput>>, options?: { priority?: number }): Context<z.ZodType<{}>>
}

// ── Implementation ──────────────────────────────────────────────────

const DEFAULT_SUMMARIZE_SYSTEM =
  'You are summarizing context being transferred between AI agents. Produce a brief, factual summary of the key information. Be concise. Do not add information not present in the data.'

function approxSize(value: unknown): number {
  return JSON.stringify(value).length
}

/**
 * Create a structured handoff for context transfer between agents.
 *
 * @param config - Configuration with id, input/output schemas, transform, optional summarize and records.
 * @returns A `HandoffInstance` with prepare(), send(), receive(), and asContext() methods.
 *
 * @example
 * ```ts
 * // Stateless (in-process)
 * const handoff = handoff({
 *   id: 'research-to-writer',
 *   inputSchema: ResearchResultSchema,
 *   outputSchema: WriterContextSchema,
 *   transform: (input) => ({ synthesis: input.synthesis, sourceCount: input.sources.length }),
 * })
 * const payload = await handoff.prepare(rawResults)
 * const ctx = handoff.asContext(payload)
 *
 * // Stored (distributed agents)
 * const handoff = handoff({
 *   id: 'research-to-writer',
 *   inputSchema: ResearchResultSchema,
 *   outputSchema: WriterContextSchema,
 *   transform: (input) => ({ ... }),
 *   records,
 * })
 * // Producer:
 * await handoff.send(rawResults)
 * // Consumer (in a different action/process):
 * const payload = await handoff.receive()
 * ```
 */
export function handoff<TInput extends z.ZodType, TOutput extends z.ZodType>(
  config: HandoffConfig<TInput, TOutput>,
): HandoffInstance<TInput, TOutput> {
  const { id, inputSchema, outputSchema, transform, records } = config
  const recordKey = `handoff:${id}`

  async function prepare(input: z.infer<TInput>): Promise<HandoffPayload<z.infer<TOutput>>> {
    return observe.span(
      {
        name: id,
        primitive: 'handoff.prepare',
        attributes: {
          handoffId: id,
          ...(config.fromAgent ? { fromAgent: config.fromAgent } : {}),
          ...(config.toAgent ? { toAgent: config.toAgent } : {}),
        },
      },
      async () => preparePayload(input),
    )
  }

  async function preparePayload(input: z.infer<TInput>): Promise<HandoffPayload<z.infer<TOutput>>> {
    // Validate input
    const validatedInput = inputSchema.parse(input)

    // Transform (may be async)
    const transformed = await Promise.resolve(transform(validatedInput))

    // Validate output
    const validatedOutput = outputSchema.parse(transformed)

    // Optional summarize
    let summary: string | undefined
    if (config.summarize) {
      const { generate, model, system } = config.summarize
      const result = await generate({
        model,
        system: system ?? DEFAULT_SUMMARIZE_SYSTEM,
        prompt: `The following context is being transferred to another agent:\n\n${JSON.stringify(validatedOutput, null, 2)}`,
      })
      summary = result.text
    }

    // Notify
    const inSize = approxSize(input)
    const outSize = approxSize(validatedOutput)
    config.onPrepare?.(id, inSize, outSize)
    return observe.span(
      {
        name: id,
        primitive: 'handoff.prepare',
        attributes: {
          handoffId: id,
          inputSize: inSize,
          outputSize: outSize,
          ...(config.fromAgent ? { fromAgent: config.fromAgent } : {}),
          ...(config.toAgent ? { toAgent: config.toAgent } : {}),
        },
      },
      () => {
        const observedContext = observe.captureContext()
        const inputArtifactId = observe.artifact({
          kind: 'input',
          contentType: 'application/json',
          encoding: 'json',
          preview: validatedInput,
          sizeBytes: inSize,
          attributes: {
            handoffId: id,
            role: 'handoff.input',
            ...(config.fromAgent ? { fromAgent: config.fromAgent } : {}),
            ...(config.toAgent ? { toAgent: config.toAgent } : {}),
          },
        })
        if (observedContext?.currentSpanId && inputArtifactId) {
          observe.edge({
            edgeType: 'consumed',
            from: { kind: 'artifact', id: inputArtifactId },
            to: { kind: 'span', id: observedContext.currentSpanId },
            attributes: { handoffId: id },
          })
        }

        const payload = {
          handoffId: id,
          data: validatedOutput,
          ...(summary !== undefined ? { summary } : {}),
          createdAt: new Date(),
        }
        const artifactId = observe.artifact({
          kind: 'handoff.payload',
          contentType: 'application/json',
          encoding: 'json',
          preview: {
            kind: 'handoff.payload',
            handoffId: id,
            ...(config.fromAgent ? { fromAgent: config.fromAgent } : {}),
            ...(config.toAgent ? { toAgent: config.toAgent } : {}),
            inputSize: inSize,
            outputSize: outSize,
            beforeSize: inSize,
            afterSize: outSize,
            data: validatedOutput,
            ...(summary !== undefined ? { summary } : {}),
          },
          sizeBytes: outSize,
          attributes: { handoffId: id, inputSize: inSize, outputSize: outSize },
        })
        if (observedContext?.currentSpanId && artifactId) {
          observe.edge({
            edgeType: 'handoff.payload',
            from: { kind: 'span', id: observedContext.currentSpanId },
            to: { kind: 'artifact', id: artifactId },
            attributes: { handoffId: id },
          })
        }
        const parentSpanId = observedContext?.spanStack[observedContext.spanStack.length - 2]
        if (parentSpanId && observedContext?.currentSpanId) {
          observe.edge({
            edgeType: 'delegate.invoked',
            from: { kind: 'span', id: parentSpanId },
            to: { kind: 'span', id: observedContext.currentSpanId },
            attributes: { handoffId: id },
          })
        }
        return payload
      },
    )
  }

  async function send(input: z.infer<TInput>): Promise<HandoffPayload<z.infer<TOutput>>> {
    if (!records) {
      throw new Error(`Handoff "${id}": send() requires records. Pass a RecordStore via the \`records\` option.`)
    }

    const payload = await prepare(input)

    await records.put(recordKey, {
      content: JSON.stringify({
        data: payload.data,
        summary: payload.summary,
        createdAt: payload.createdAt.toISOString(),
      }),
      metadata: { handoffId: id, type: 'handoff' },
      updatedAt: Date.now(),
    } satisfies JsonObject)

    return payload
  }

  async function receive(): Promise<HandoffPayload<z.infer<TOutput>> | null> {
    if (!records) {
      throw new Error(`Handoff "${id}": receive() requires records. Pass a RecordStore via the \`records\` option.`)
    }

    const entry = await records.get(recordKey)
    if (!entry) return null

    try {
      const parsed = JSON.parse(entry.content as string) as {
        data: z.infer<TOutput>
        summary?: string
        createdAt: string
      }

      return {
        handoffId: id,
        data: parsed.data,
        ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
        createdAt: new Date(parsed.createdAt),
      }
    } catch {
      return null
    }
  }

  function asContext(
    payload: HandoffPayload<z.infer<TOutput>>,
    options?: { priority?: number },
  ): Context<z.ZodType<{}>> {
    const priority = options?.priority ?? 80

    return contextWithFamily({
      id: `handoff:${id}`,
      description: `Handoff context from ${id}`,
      priority,
      system: async () => {
        const lines = [`## Handoff Context (${id})`]

        if (payload.summary) {
          lines.push('### Summary')
          lines.push(payload.summary)
          lines.push('')
        }

        lines.push('### Data')
        lines.push('```json')
        lines.push(JSON.stringify(payload.data, null, 2))
        lines.push('```')

        return lines.join('\n')
      },
    }, 'handoff')
  }

  return {
    id,
    inputSchema,
    outputSchema,
    prepare,
    send,
    receive,
    asContext,
  }
}
