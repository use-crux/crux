/**
 * Shared tool instrumentation policy for adapter factories.
 *
 * Owns the wrapping of tool `execute`/`needsApproval`/`toModelOutput`
 * with runtime instrumentation hooks, plus the canonical helpers for
 * shaping, rendering, and measuring tool model output. Used by both
 * `adapter()` (core-driven loop) and `executorAdapter()` (SDK-driven
 * loop) so hook ordering and payload shapes never diverge.
 *
 * @module
 */

import { getRuntime } from '../../runtime'
import { observe } from '../../observability'
import type { JsonValue, ToolContentPart, ToolModelOutput } from '../../types/tool'

// ─────────────────────────────────────────────────────────────────
// Tool model output helpers
// ─────────────────────────────────────────────────────────────────

/** Structural shape of a tool that can shape its own model output. */
export interface ModelOutputCapableTool {
  toModelOutput?: (args: {
    toolCallId: string
    input: Record<string, unknown>
    output: unknown
  }) => ToolModelOutput | Promise<ToolModelOutput>
}

/**
 * Shape a tool's raw result into the `ToolModelOutput` fed back to the model.
 *
 * Honors the tool's own `toModelOutput` hook when present (a tool can
 * summarize a 50KB query result down to three lines); otherwise applies
 * the default shaping from {@link defaultToolModelOutput}. This is the one
 * place that decides what the model sees after a tool runs, so the
 * raw-result → model-output translation is identical in every adapter.
 */
export async function createToolModelOutput(args: {
  tool: ModelOutputCapableTool
  toolCallId: string
  input: Record<string, unknown>
  output: unknown
}): Promise<ToolModelOutput> {
  if (args.tool.toModelOutput) {
    return args.tool.toModelOutput({
      toolCallId: args.toolCallId,
      input: args.input,
      output: args.output,
    })
  }

  return defaultToolModelOutput(args.output)
}

/** Default model output shaping: strings pass through, everything else is JSON. */
export function defaultToolModelOutput(output: unknown): ToolModelOutput {
  return typeof output === 'string' ? { type: 'text', value: output } : { type: 'json', value: toJsonValue(output) }
}

/** Narrow unknown tool input to a record (tool args are object-shaped by contract). */
export function normalizeToolInput(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

/**
 * Render a `ToolModelOutput` to the plain string that providers without
 * native structured tool results receive.
 *
 * Text variants pass through verbatim, JSON variants are serialized,
 * denials become a human-readable refusal the model can reason about, and
 * rich `content` parts (images, files, media) collapse to bracketed
 * placeholders like `[image:image/png] data:…` — enough for the model to
 * know something non-textual came back.
 */
export function renderToolModelOutput(output: ToolModelOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value)
    case 'execution-denied':
      return output.reason ? `Tool execution denied: ${output.reason}` : 'Tool execution denied.'
    case 'content':
      return renderContentParts(output.value)
  }
}

function renderContentParts(parts: readonly ToolContentPart[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text
        case 'media':
          return `[media:${part.mediaType}] data:${part.data}`
        case 'file-data':
          return `[file:${part.mediaType}${part.filename ? `; name=${part.filename}` : ''}] data:${part.data}`
        case 'file-url':
          return `[file] ${part.url}`
        case 'file-id':
          return `[file-id] ${typeof part.fileId === 'string' ? part.fileId : JSON.stringify(part.fileId)}`
        case 'image-data':
          return `[image:${part.mediaType}] data:${part.data}`
        case 'image-url':
          return `[image] ${part.url}`
        case 'image-file-id':
          return `[image-file-id] ${typeof part.fileId === 'string' ? part.fileId : JSON.stringify(part.fileId)}`
        case 'custom':
          return `[custom] ${JSON.stringify(part.providerOptions ?? {})}`
      }
    })
    .join('\n')
}

/** Measure a model output payload (chars ≈ token proxy for savings estimates). */
export function measureModelOutput(output: ToolModelOutput): number {
  return measureUnknown(output)
}

/** Measure any payload: string length or JSON-serialized length. */
export function measureUnknown(value: unknown): number {
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value ?? null).length
  } catch {
    return 0
  }
}

/** Coerce any value to a `JsonValue` (undefined and unserializable → null). */
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as JsonValue
}

// ─────────────────────────────────────────────────────────────────
// Tool span/artifact emission
// ─────────────────────────────────────────────────────────────────

/** Open a `tool.call` span for a tool execution. */
export function openToolCallSpan(
  toolName: string,
  toolCallId: string,
  args: unknown,
): ReturnType<typeof observe.openSpan> {
  return observe.openSpan({
    name: toolName,
    family: 'tool',
    primitive: 'tool.call',
    attributes: {
      toolName,
      toolCallId,
      inputSize: measureUnknown(args),
    },
  })
}

/** Emit a `tool.args` artifact consumed by the given span. */
export function emitToolArgsArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  toolName: string,
  toolCallId: string,
  args: unknown,
): void {
  const artifactId = observe.artifact({
    kind: 'tool.args',
    contentType: 'application/json',
    encoding: 'json',
    preview: toJsonValue(args),
    attributes: {
      toolName,
      toolCallId,
      inputSize: measureUnknown(args),
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'consumed',
      from: { kind: 'artifact', id: artifactId },
      to: { kind: 'span', id: spanId },
      attributes: { toolName, toolCallId },
    })
  }
}

/** Emit a `tool.result` artifact produced by the given span. */
export function emitToolResultArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  toolName: string,
  toolCallId: string,
  result: unknown,
  attributes: Record<string, unknown>,
): void {
  const artifactId = observe.artifact({
    kind: 'tool.result',
    contentType: 'application/json',
    encoding: 'json',
    preview: toJsonValue(result),
    attributes: {
      toolName,
      toolCallId,
      ...attributes,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { toolName, toolCallId, ...attributes },
    })
  }
}

/** Emit `tool.request` artifacts for the tool calls a response asked for. */
export function emitToolRequestArtifacts(
  toolCalls: ReadonlyArray<{ readonly id: string; readonly name: string; readonly args: unknown }>,
): void {
  const spanId = observe.captureContext()?.currentSpanId
  for (const toolCall of toolCalls) {
    const artifactId = observe.artifact({
      kind: 'tool.request',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        args: toJsonValue(toolCall.args),
      },
      attributes: {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        inputSize: measureUnknown(toolCall.args),
      },
    })
    if (artifactId && spanId) {
      observe.edge({
        edgeType: 'produced',
        from: { kind: 'span', id: spanId },
        to: { kind: 'artifact', id: artifactId },
        attributes: { toolName: toolCall.name, toolCallId: toolCall.id },
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// instrumentToolSet — leak-free hook wrappers
// ─────────────────────────────────────────────────────────────────

/**
 * Structural shapes of the tool members we wrap. Tool objects are heavily
 * generic in SDK land; the wrappers are passthroughs, so structural typing
 * is sufficient here.
 */
type ToolExecute = (input: unknown, options: { toolCallId?: string; [key: string]: unknown }) => unknown
type ToolToModelOutput = (args: {
  toolCallId: string
  input: unknown
  output: unknown
}) => ToolModelOutput | Promise<ToolModelOutput>

interface PendingToolCall {
  start: number
  input: unknown
  output: unknown
  outputSize: number
}

/** Options for {@link instrumentToolSet}. */
export interface InstrumentToolSetOptions {
  /**
   * Upper bound on pending `execute` results awaiting `toModelOutput`.
   * When exceeded, the oldest entry is evicted; an evicted call still
   * completes via the `toModelOutput` args payload (degraded timing only).
   * Prevents unbounded growth when the SDK never invokes `toModelOutput`.
   * @default 1000
   */
  readonly maxPending?: number
}

const DEFAULT_MAX_PENDING = 1000

/**
 * Wrap every tool in a tool map with timing and instrumentation hooks so
 * devtools and OTel see each call — without the tool author writing any
 * instrumentation code.
 *
 * Adapters call this once on the merged tool map right before handing tools
 * to their SDK. Consumers never call it directly; they just see their tools
 * appear in devtools.
 *
 * @remarks
 * Hook semantics, in order:
 * - `onToolStart` fires before `execute` runs, with the raw args.
 * - For tools **without** `toModelOutput`, `onToolEnd` fires as soon as
 *   `execute` settles, carrying the result, a default-shaped model output,
 *   payload sizes, and a token-savings estimate.
 * - For tools **with** `toModelOutput`, `onToolEnd` is deferred until
 *   `toModelOutput` settles so the hook sees both the raw result *and* the
 *   shaped output in one event. The in-flight result is parked in a bounded
 *   pending map keyed by `toolCallId`.
 * - `needsApproval` is NOT wrapped: `onToolApprovalRequest` is the
 *   lifecycle session's to emit (at gate suspension or `suspend()` sealing),
 *   so the hook fires exactly once per request in both regimes.
 *
 * Pending state cannot leak: entries are deleted when `toModelOutput`
 * settles (including throws), and the map is capped by
 * {@link InstrumentToolSetOptions.maxPending} with oldest-first eviction
 * for the pathological case where an SDK never invokes `toModelOutput`.
 * An evicted call still completes correctly — the hook falls back to the
 * payload `toModelOutput` received, losing only the timing data.
 *
 * @param tools - The tool map (AI SDK `ToolSet`-shaped or core tool records).
 *   `undefined` passes through untouched.
 * @param options - See {@link InstrumentToolSetOptions}.
 * @returns The same reference when no tool hooks are registered (zero
 *   overhead in production); otherwise a new map of wrapped tools.
 */
export function instrumentToolSet<TTools extends Record<string, unknown>>(
  tools: TTools | undefined,
  options?: InstrumentToolSetOptions,
): TTools | undefined {
  if (!tools) return tools
  const hooks = getRuntime().instrumentationHooks
  if (!hooks?.onToolStart && !hooks?.onToolEnd) return tools

  const maxPending = options?.maxPending ?? DEFAULT_MAX_PENDING
  const wrapped: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const toolLike = tool as {
      execute?: ToolExecute
      toModelOutput?: ToolToModelOutput
    } | null
    const execute = toolLike?.execute
    if (!tool || typeof execute !== 'function') {
      wrapped[name] = tool
      continue
    }
    const originalExecute: ToolExecute = execute
    const originalToModelOutput = toolLike?.toModelOutput
    const pending = new Map<string, PendingToolCall>()
    const rememberPending = (toolCallId: string, entry: PendingToolCall): void => {
      pending.set(toolCallId, entry)
      if (pending.size > maxPending) {
        const oldest = pending.keys().next().value
        if (oldest !== undefined) pending.delete(oldest)
      }
    }
    wrapped[name] = {
      ...tool,
      execute: async function instrumentedExecute(
        this: unknown,
        input: unknown,
        options: { toolCallId?: string; [key: string]: unknown },
      ) {
        const toolCallId = options?.toolCallId ?? `tc_${Date.now()}`
        const start = Date.now()
        hooks.onToolStart?.({ toolCallId, toolName: name, args: input })
        try {
          const result = await originalExecute.call(this, input, options)
          const outputSize = measureUnknown(result)
          if (originalToModelOutput) {
            rememberPending(toolCallId, { start, input, output: result, outputSize })
          } else {
            const modelOutput = defaultToolModelOutput(result)
            const modelOutputSize = measureUnknown(modelOutput)
            hooks.onToolEnd?.({
              toolCallId,
              toolName: name,
              durationMs: Date.now() - start,
              result,
              modelOutput,
              modelOutputType: modelOutput.type,
              outputSize,
              modelOutputSize,
              tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
            })
          }
          return result
        } catch (err) {
          hooks.onToolEnd?.({
            toolCallId,
            toolName: name,
            durationMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      },
      ...(originalToModelOutput
        ? {
            toModelOutput: async function instrumentedToModelOutput(
              this: unknown,
              args: {
                toolCallId: string
                input: unknown
                output: unknown
              },
            ) {
              const pendingTool = pending.get(args.toolCallId)
              try {
                const modelOutput = await originalToModelOutput.call(this, args)
                const outputSize = pendingTool?.outputSize ?? measureUnknown(args.output)
                const modelOutputSize = measureUnknown(modelOutput)
                hooks.onToolEnd?.({
                  toolCallId: args.toolCallId,
                  toolName: name,
                  durationMs: Date.now() - (pendingTool?.start ?? Date.now()),
                  result: pendingTool?.output ?? args.output,
                  modelOutput,
                  modelOutputType: modelOutput.type,
                  outputSize,
                  modelOutputSize,
                  tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
                })
                return modelOutput
              } catch (err) {
                hooks.onToolEnd?.({
                  toolCallId: args.toolCallId,
                  toolName: name,
                  durationMs: Date.now() - (pendingTool?.start ?? Date.now()),
                  result: pendingTool?.output ?? args.output,
                  outputSize: pendingTool?.outputSize ?? measureUnknown(args.output),
                  modelOutputError: err instanceof Error ? err.message : String(err),
                  error: err instanceof Error ? err.message : String(err),
                })
                throw err
              } finally {
                pending.delete(args.toolCallId)
              }
            },
          }
        : {}),
    }
  }
  return wrapped as TTools
}
