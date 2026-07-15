/**
 * Shared tool instrumentation policy for adapter factories.
 *
 * Owns the wrapping of tool `execute`/`toModelOutput`
 * with canonical observability graph records, plus the helpers for
 * shaping, rendering, and measuring tool model output. Used by both
 * `adapter()` (core-driven loop) and `loopRuntimeAdapter()` (SDK-driven
 * loop) so tool timing and payload shapes never diverge.
 *
 * @module
 */

import { getHooks } from "../../runtime/runtime";
import {
  currentObservabilityTransport,
  hasObservabilitySubscribers,
  observe,
} from "../../observability";
import { toolDefinitionRef } from "../../observability/definition-ref";
import { toolMiddlewareDefinitionRefs } from "../../tools/middleware";
import type { DefinitionRef } from "../../observability/contract";
import {
  toolSourceProvenance,
  type ToolSourceProvenance,
} from "../../tools/tool-source";
import { isToolExecutionMock } from "../../tools/mock";
import { createToolRegistry } from "../../tools/tool-registry";
import { redactSensitiveValue } from "../../shared/redaction";
import { contentText } from "../../content";
import type { ContentPart } from "../../types/content";
import type { JsonValue, ToolModelOutput } from "../../types/tool";

// ─────────────────────────────────────────────────────────────────
// Tool model output helpers
// ─────────────────────────────────────────────────────────────────

/** Structural shape of a tool that can shape its own model output. */
export interface ModelOutputCapableTool {
  toModelOutput?: (args: {
    toolCallId: string;
    input: Record<string, unknown>;
    output: unknown;
  }) => ToolModelOutput | Promise<ToolModelOutput>;
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
  tool: ModelOutputCapableTool;
  toolCallId: string;
  input: Record<string, unknown>;
  output: unknown;
}): Promise<ToolModelOutput> {
  if (args.tool.toModelOutput) {
    return args.tool.toModelOutput({
      toolCallId: args.toolCallId,
      input: args.input,
      output: args.output,
    });
  }

  return defaultToolModelOutput(args.output);
}

/** Default model output shaping: strings pass through, everything else is JSON. */
export function defaultToolModelOutput(output: unknown): ToolModelOutput {
  return typeof output === "string"
    ? { type: "text", value: output }
    : { type: "json", value: toJsonValue(output) };
}

/** Narrow unknown tool input to a record (tool args are object-shaped by contract). */
export function normalizeToolInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/**
 * Render a `ToolModelOutput` to the plain string that providers without
 * native structured tool results receive.
 *
 * Text variants pass through verbatim, JSON variants are serialized,
 * denials become a human-readable refusal the model can reason about, and
 * rich `content` parts (images, files) collapse to bracketed
 * placeholders like `[image:image/png] data:…` — enough for the model to
 * know something non-textual came back.
 */
export function renderToolModelOutput(output: ToolModelOutput): string {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value;
    case "json":
    case "error-json":
      return JSON.stringify(output.value);
    case "execution-denied":
      return output.reason
        ? `Tool execution denied: ${output.reason}`
        : "Tool execution denied.";
    case "content":
      return renderContentParts(output.value);
  }
}

/** Read a `ToolModelOutput` that was stashed on message metadata. */
export function toolModelOutputFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ToolModelOutput | undefined {
  const output = metadata?.modelOutput;
  return isToolModelOutput(output) ? output : undefined;
}

/** Type guard for Crux tool model output values crossing adapter metadata. */
export function isToolModelOutput(value: unknown): value is ToolModelOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { readonly type?: unknown }).type === "string"
  );
}

function renderContentParts(parts: readonly ContentPart[]): string {
  return contentText(parts);
}

/** Measure a model output payload (chars ≈ token proxy for savings estimates). */
export function measureModelOutput(output: ToolModelOutput): number {
  return measureUnknown(output);
}

/** Measure any payload: string length or JSON-serialized length. */
export function measureUnknown(value: unknown): number {
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

/** Coerce any value to a `JsonValue` (undefined and unserializable → null). */
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
}

// ─────────────────────────────────────────────────────────────────
// Tool span/artifact emission
// ─────────────────────────────────────────────────────────────────

/** Open a `tool.call` span for a tool execution. */
export function openToolCallSpan(
  toolName: string,
  toolCallId: string,
  args: unknown,
  definitionRefs?: readonly DefinitionRef[],
  provenance?: ToolSourceProvenance,
): ReturnType<typeof observe.openSpan> {
  const span = observe.openSpan({
    name: toolName,
    primitive: "tool.call",
    attributes: {
      ...provenance?.attributes,
      toolName,
      toolCallId,
      inputSize: measureUnknown(args),
    },
    ...(definitionRefs && definitionRefs.length > 0
      ? { definitionRefs: [...definitionRefs] }
      : {}),
  });
  if (provenance?.causedBySpanIds) {
    span.withContext(() => {
      for (const preparationSpanId of provenance.causedBySpanIds ?? []) {
        observe.edge({
          edgeType: "caused",
          from: { kind: "span", id: preparationSpanId },
          to: { kind: "span", id: span.spanId },
        });
      }
    });
  }
  return span;
}

/**
 * Canonical `invoked-tool` ref for a compiled tool handle, or `undefined` when
 * the tool carries no authored `name`/`title`. The model-facing tool-map key is
 * not the authored identity, so an unnamed tool (indexer would fall back to its
 * local variable name) yields no ref rather than a guessed one.
 */
function toolCallDefinitionRefs(tool: unknown): DefinitionRef[] | undefined {
  const authored = tool as { name?: unknown; title?: unknown } | null;
  const authoredName =
    typeof authored?.name === "string" && authored.name.length > 0
      ? authored.name
      : typeof authored?.title === "string" && authored.title.length > 0
        ? authored.title
        : undefined;
  const refs = [
    ...(authoredName ? [toolDefinitionRef(authoredName)] : []),
    ...toolMiddlewareDefinitionRefs(tool),
  ];
  return refs.length > 0 ? refs : undefined;
}

/** Emit a `tool.args` artifact consumed by the given span. */
export function emitToolArgsArtifact(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  toolName: string,
  toolCallId: string,
  args: unknown,
): void {
  const artifactId = observe.artifact({
    kind: "tool.args",
    contentType: "application/json",
    encoding: "json",
    preview: toJsonValue(redactSensitiveValue(args)),
    attributes: {
      toolName,
      toolCallId,
      inputSize: measureUnknown(args),
    },
  });
  if (artifactId) {
    observe.edge({
      edgeType: "consumed",
      from: { kind: "artifact", id: artifactId },
      to: { kind: "span", id: spanId },
      attributes: { toolName, toolCallId },
    });
  }
}

/** Emit a `tool.result` artifact produced by the given span. */
export function emitToolResultArtifact(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  toolName: string,
  toolCallId: string,
  result: unknown,
  attributes: Record<string, unknown>,
  preview: unknown = result,
): void {
  const artifactId = observe.artifact({
    kind: "tool.result",
    contentType: "application/json",
    encoding: "json",
    preview: toJsonValue(redactSensitiveValue(preview)),
    attributes: {
      toolName,
      toolCallId,
      ...attributes,
    },
  });
  if (artifactId) {
    observe.edge({
      edgeType: "produced",
      from: { kind: "span", id: spanId },
      to: { kind: "artifact", id: artifactId },
      attributes: { toolName, toolCallId, ...attributes },
    });
  }
}

/** Emit `tool.request` artifacts for the tool calls a response asked for. */
export function emitToolRequestArtifacts(
  toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly args: unknown;
  }>,
): void {
  const spanId = observe.captureContext()?.currentSpanId;
  for (const toolCall of toolCalls) {
    const artifactId = observe.artifact({
      kind: "tool.request",
      contentType: "application/json",
      encoding: "json",
      preview: {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        args: toJsonValue(redactSensitiveValue(toolCall.args)),
      },
      attributes: {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        inputSize: measureUnknown(toolCall.args),
      },
    });
    if (artifactId && spanId) {
      observe.edge({
        edgeType: "produced",
        from: { kind: "span", id: spanId },
        to: { kind: "artifact", id: artifactId },
        attributes: { toolName: toolCall.name, toolCallId: toolCall.id },
      });
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
interface InstrumentedToolExecutionOptions {
  readonly toolCallId?: string;
  readonly messages?: readonly unknown[];
  readonly context?: unknown;
  readonly runtimeContext?: unknown;
  readonly abortSignal?: AbortSignal;
}

type ToolExecute = (
  input: unknown,
  options?: InstrumentedToolExecutionOptions,
) => unknown;
type ToolToModelOutput = (args: {
  toolCallId: string;
  input: unknown;
  output: unknown;
}) => ToolModelOutput | Promise<ToolModelOutput>;

interface PendingToolCall {
  start: number;
  input: unknown;
  output: unknown;
  outputSize: number;
  span: ReturnType<typeof openToolCallSpan>;
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
  readonly maxPending?: number;
}

const DEFAULT_MAX_PENDING = 1000;

/**
 * Wrap every tool in a tool map with timing and observability records so
 * devtools, subscribers, and OTel see each call — without the tool author writing any
 * instrumentation code.
 *
 * Adapters call this once on the merged tool map right before handing tools
 * to their SDK. Consumers never call it directly; they just see their tools
 * appear in devtools.
 *
 * @remarks
 * Record semantics, in order:
 * - A canonical `tool.call` span opens and consumes a `tool.args`
 *   artifact before `execute` runs.
 * - For tools **without** `toModelOutput`, the span produces raw
 *   and model-facing `tool.result` artifacts and closes.
 * - For tools **with** `toModelOutput`, span closure is deferred until
 *   `toModelOutput` settles so the graph captures both the raw result *and*
 *   the shaped output. The in-flight result is parked in a bounded
 *   pending map keyed by `toolCallId`; the same span is closed when the
 *   model-facing output is known.
 * - Approval policy is NOT wrapped here: approval lifecycle records are
 *   emitted by the tool session at gate suspension or `suspend()` sealing.
 *
 * Pending state cannot leak: entries are deleted when `toModelOutput`
 * settles (including throws), and the map is capped by
 * {@link InstrumentToolSetOptions.maxPending} with oldest-first eviction
 * for the pathological case where an SDK never invokes `toModelOutput`.
 * An evicted call still completes correctly from the payload
 * `toModelOutput` received, losing only the timing data.
 *
 * @param tools - The tool map (AI SDK `ToolSet`-shaped or core tool records).
 *   `undefined` passes through untouched.
 * @param options - See {@link InstrumentToolSetOptions}.
 * @returns The same reference when no observability
 *   transport are registered (zero overhead in production); otherwise a new
 *   map of wrapped tools.
 */
export function instrumentToolSet<TTools extends Record<string, unknown>>(
  tools: TTools | undefined,
  options?: InstrumentToolSetOptions,
): TTools | undefined {
  if (!tools) return tools;
  const runtime = getHooks();
  const shouldInstrument =
    hasObservabilitySubscribers() ||
    currentObservabilityTransport() !== undefined ||
    runtime.observabilityTransport !== undefined;
  if (!shouldInstrument) return tools;

  const maxPending = options?.maxPending ?? DEFAULT_MAX_PENDING;
  const wrapped = createToolRegistry<unknown>();
  for (const [name, tool] of Object.entries(tools)) {
    const toolLike = tool as {
      execute?: ToolExecute;
      toModelOutput?: ToolToModelOutput;
    } | null;
    const execute = toolLike?.execute;
    if (!tool || typeof execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute: ToolExecute = execute;
    const originalToModelOutput = toolLike?.toModelOutput;
    // Compiled-handle-derived ref: read the authored name off the tool object
    // once, so every call to this tool carries the same canonical invoked-tool ref.
    const provenance = toolCallProvenance(tool);
    const definitionRefs = mergeDefinitionRefs(
      toolCallDefinitionRefs(tool),
      provenance?.definitionRefs,
    );
    const pending = new Map<string, PendingToolCall>();
    const rememberPending = (
      toolCallId: string,
      entry: PendingToolCall,
    ): void => {
      pending.set(toolCallId, entry);
      if (pending.size > maxPending) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) {
          const evicted = pending.get(oldest);
          evicted?.span.end({
            status: "skipped",
            attributes: {
              isError: false,
              outputSize: evicted.outputSize,
              modelOutputDeferred: true,
              pendingEvicted: true,
            },
          });
          pending.delete(oldest);
        }
      }
    };
    wrapped[name] = {
      ...tool,
      execute: async function instrumentedExecute(
        this: unknown,
        input: unknown,
        options?: InstrumentedToolExecutionOptions,
      ) {
        const toolCallId = options?.toolCallId ?? `tc_${Date.now()}`;
        const executionOptions: InstrumentedToolExecutionOptions = {
          ...(options ?? {}),
          toolCallId,
        };
        const start = Date.now();
        const span = openToolCallSpan(
          name,
          toolCallId,
          input,
          definitionRefs,
          provenance,
        );
        try {
          span.withContext(() =>
            emitToolArgsArtifact(span.spanId, name, toolCallId, input),
          );
          const result = await span.withContext(() =>
            originalExecute.call(this, input, executionOptions),
          );
          const outputSize = measureUnknown(result);
          if (originalToModelOutput) {
            rememberPending(toolCallId, {
              start,
              input,
              output: result,
              outputSize,
              span,
            });
          } else {
            const modelOutput = defaultToolModelOutput(result);
            const modelOutputSize = measureUnknown(modelOutput);
            span.withContext(() => {
              emitToolResultArtifact(
                span.spanId,
                name,
                toolCallId,
                result,
                {
                  resultKind: "raw",
                  outputSize,
                  isError: false,
                },
                sourceResultPreview(provenance, result),
              );
              emitToolResultArtifact(
                span.spanId,
                name,
                toolCallId,
                modelOutput,
                {
                  resultKind: "model",
                  modelOutputType: modelOutput.type,
                  modelOutputSize,
                  tokenSavingsEstimate: Math.max(
                    0,
                    outputSize - modelOutputSize,
                  ),
                  isError: false,
                },
                sourceResultPreview(provenance, modelOutput),
              );
            });
            span.end({
              attributes: {
                isError: false,
                outputSize,
                modelOutputSize,
                modelOutputType: modelOutput.type,
                tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
              },
            });
          }
          return result;
        } catch (err) {
          const modelOutput: ToolModelOutput = {
            type: "error-json",
            value: { error: err instanceof Error ? err.message : String(err) },
          };
          const modelOutputSize = measureModelOutput(modelOutput);
          span.withContext(() => {
            emitToolResultArtifact(span.spanId, name, toolCallId, modelOutput, {
              resultKind: "model",
              modelOutputType: modelOutput.type,
              modelOutputSize,
              tokenSavingsEstimate: 0,
              isError: true,
              errorKind: "execute_error",
            });
          });
          span.error(err, {
            ...provenance?.errorAttributes,
            isError: true,
            phase: "tool.execute",
            errorKind: "execute_error",
            outputSize: 0,
            modelOutputSize,
            modelOutputType: modelOutput.type,
            tokenSavingsEstimate: 0,
          });
          throw err;
        }
      },
      ...(originalToModelOutput
        ? {
            toModelOutput: async function instrumentedToModelOutput(
              this: unknown,
              args: {
                toolCallId: string;
                input: unknown;
                output: unknown;
              },
            ) {
              const pendingTool = pending.get(args.toolCallId);
              try {
                const modelOutput = pendingTool
                  ? await pendingTool.span.withContext(() =>
                      originalToModelOutput.call(this, args),
                    )
                  : await originalToModelOutput.call(this, args);
                const outputSize =
                  pendingTool?.outputSize ?? measureUnknown(args.output);
                const modelOutputSize = measureUnknown(modelOutput);
                pendingTool?.span.withContext(() => {
                  emitToolResultArtifact(
                    pendingTool.span.spanId,
                    name,
                    args.toolCallId,
                    pendingTool.output,
                    {
                      resultKind: "raw",
                      outputSize,
                      isError: false,
                    },
                    sourceResultPreview(provenance, pendingTool.output),
                  );
                  emitToolResultArtifact(
                    pendingTool.span.spanId,
                    name,
                    args.toolCallId,
                    modelOutput,
                    {
                      resultKind: "model",
                      modelOutputType: modelOutput.type,
                      modelOutputSize,
                      tokenSavingsEstimate: Math.max(
                        0,
                        outputSize - modelOutputSize,
                      ),
                      isError: false,
                    },
                    sourceResultPreview(provenance, modelOutput),
                  );
                });
                pendingTool?.span.end({
                  attributes: {
                    isError: false,
                    outputSize,
                    modelOutputSize,
                    modelOutputType: modelOutput.type,
                    tokenSavingsEstimate: Math.max(
                      0,
                      outputSize - modelOutputSize,
                    ),
                  },
                });
                return modelOutput;
              } catch (err) {
                const modelOutput: ToolModelOutput = {
                  type: "error-json",
                  value: {
                    error: err instanceof Error ? err.message : String(err),
                  },
                };
                const modelOutputSize = measureModelOutput(modelOutput);
                pendingTool?.span.withContext(() => {
                  emitToolResultArtifact(
                    pendingTool.span.spanId,
                    name,
                    args.toolCallId,
                    modelOutput,
                    {
                      resultKind: "model",
                      modelOutputType: modelOutput.type,
                      modelOutputSize,
                      tokenSavingsEstimate: 0,
                      isError: true,
                      errorKind: "model_output_error",
                    },
                    sourceResultPreview(provenance, modelOutput),
                  );
                });
                pendingTool?.span.error(err, {
                  ...provenance?.errorAttributes,
                  isError: true,
                  phase: "tool.toModelOutput",
                  errorKind: "model_output_error",
                  outputSize:
                    pendingTool?.outputSize ?? measureUnknown(args.output),
                  modelOutputSize,
                  modelOutputType: modelOutput.type,
                  tokenSavingsEstimate: 0,
                });
                throw err;
              } finally {
                pending.delete(args.toolCallId);
              }
            },
          }
        : {}),
    };
  }
  return wrapped as TTools;
}

function mergeDefinitionRefs(
  ...groups: readonly (readonly DefinitionRef[] | undefined)[]
): DefinitionRef[] | undefined {
  const refs = new Map<string, DefinitionRef>();
  for (const group of groups) {
    for (const reference of group ?? []) {
      refs.set(
        `${reference.kind}\0${reference.id}\0${reference.role}`,
        reference,
      );
    }
  }
  return refs.size > 0 ? [...refs.values()] : undefined;
}

/** Apply a source projector without allowing evidence code to affect execution. */
export function sourceResultPreview(
  provenance: ToolSourceProvenance | undefined,
  result: unknown,
): unknown {
  try {
    return provenance?.resultPreview?.(result) ?? result;
  } catch {
    return { unavailable: true };
  }
}

/** Merge source origin with execution-mock identity for an ordinary call. */
export function toolCallProvenance(
  tool: unknown,
): ToolSourceProvenance | undefined {
  const source = toolSourceProvenance(tool);
  if (!isToolExecutionMock(tool)) return source;
  return {
    attributes: { ...source?.attributes, mocked: true },
    definitionRefs: source?.definitionRefs ?? [],
    ...(source?.causedBySpanIds
      ? { causedBySpanIds: source.causedBySpanIds }
      : {}),
    ...(source?.errorAttributes
      ? { errorAttributes: source.errorAttributes }
      : {}),
    ...(source?.resultPreview ? { resultPreview: source.resultPreview } : {}),
  };
}
