/**
 * `fakeLoopRuntime()` — a fully in-memory {@link LoopRuntimePort} you script
 * with model emissions.
 *
 * Use it to test `loopRuntimeAdapter()` policy (routing, validation retry,
 * approvals, steering) with zero SDK involvement. It is also the reference
 * implementation of the loop runtime contract: it honors `maxSteps`, awaits
 * the observer and applies directives (including `refundStep`), suspends on
 * approval-gated tools, and validates structured scripts against the real
 * schema — the honesty that lets fake-backed policy tests transfer to real SDKs.
 *
 * @module
 */

import { ZodError } from "zod";
import type { ModelInfo } from "../../types";
import type { GenerationSettings } from "../../generation/types";
import type { Message } from "../../generation/messages";
import type { AdapterResponse } from "../types";
import type { LoopRuntimePort } from "../loop-runtime-port";
import type {
  ExecutorOutcome,
  ExecutorProviderStreamHandle,
  ExecutorRequest,
  PendingToolApproval,
  StepDirective,
  StepTransformer,
  StructuredAttempt,
} from "../executor-types";
import type { StructuredOutputCapabilities } from "../structured-output";
import type { ResultStepFacts } from "../result-accumulator";
import { repairJsonText } from "../../generation/repair-json";
import { responseContent, textFromAssistantContent } from "../assistant-output";
import { transformCanonicalStep } from "../step-transform";
import {
  applySystemMessagePrefixPatch,
  systemMessagePrefixPatch,
} from "../execution/system-prefix-patch";
import {
  toJsonValue,
  renderToolModelOutput,
  createToolModelOutput,
  normalizeToolInput,
} from "../tool/emission";

/** One scripted model emission inside a `runTextLoop` script. */
export interface FakeLoopEmission {
  /** Assistant text for this step. */
  readonly text?: string;
  /** Transport retries attributed to this provider call. */
  readonly transportRetries?: number;
  /**
   * Tool calls the "model" requests this step. The fake executes them
   * against the request's (instrumented) tool map, exactly like a real
   * SDK loop would.
   */
  readonly toolCalls?: ReadonlyArray<{
    readonly id?: string;
    readonly name: string;
    readonly args: unknown;
  }>;
}

/** Configuration for {@link fakeLoopRuntime}. */
export interface FakeLoopRuntimeConfig {
  /**
   * Scripts consumed one per `runTextLoop()` call. Each script is the
   * sequence of model emissions for that loop; an `Error` entry makes that
   * call throw (for fallback/routing tests).
   * @defaultValue a single `[{ text: 'fake response' }]` script, reused
   */
  readonly loops?: ReadonlyArray<readonly FakeLoopEmission[] | Error>;
  /**
   * Raw model texts consumed one per `runStructuredAttempt()` call. The fake
   * validates each against the request's schema and returns `ok` or
   * `invalid` accordingly — script invalid JSON to drive retry policy.
   */
  readonly structured?: ReadonlyArray<string | Error>;
  /** Chunk sequences consumed one per `runStream()` call. */
  readonly streams?: ReadonlyArray<readonly string[]>;
  /** Cost reported in every outcome's meta, when set. */
  readonly costUsd?: number;
}

/** The raw "SDK result" type produced by the fake loop runtime. */
export interface FakeRawResponse {
  readonly kind: "fake-loop" | "fake-structured";
  readonly text: string;
  /** Parsed provider wire value (not manifest-decoded or authored-validated). */
  readonly wireValue?: unknown;
  /** The system prompt in effect for the FINAL step (observes `amend`). */
  readonly system: string | undefined;
}

/**
 * The fake accepts every JSON Schema semantic the compiler can emit, so its
 * compiled wire schema equals the authored `z.input` shape and its decode
 * manifest is empty. Core still owns the sole authored parse — the fake only
 * performs the structural (JSON) validation a real SDK does against a wire
 * schema.
 */
const FAKE_STRUCTURED_CAPABILITIES: StructuredOutputCapabilities = {
  id: "fake",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: true,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [],
};

/** The raw "SDK stream result" type produced by the fake loop runtime. */
export interface FakeRawStream {
  readonly kind: "fake-stream";
  readonly chunks: readonly string[];
  readonly text: string;
}

/** A scripted fake loop runtime plus its recorded calls. */
export interface FakeLoopRuntime {
  /** The {@link LoopRuntimePort} to pass to `loopRuntimeAdapter()`. */
  readonly runtime: LoopRuntimePort<string, FakeRawResponse, FakeRawStream>;
  /** Every request each method received, in call order — assert on these. */
  readonly calls: {
    readonly runTextLoop: Array<ExecutorRequest<string>>;
    readonly runStructuredAttempt: Array<ExecutorRequest<string>>;
    readonly runStream: Array<ExecutorRequest<string>>;
  };
}

const FAKE_USAGE = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const;

interface FakeToolLike {
  execute?: (
    input: unknown,
    options: { toolCallId?: string; messages?: readonly unknown[] },
  ) => unknown;
  toModelOutput?: (args: {
    toolCallId: string;
    input: Record<string, unknown>;
    output: unknown;
  }) =>
    | import("../../types/tool").ToolModelOutput
    | Promise<import("../../types/tool").ToolModelOutput>;
}

/**
 * Create a scripted, fully in-memory {@link LoopRuntimePort} — the official
 * test double for `loopRuntimeAdapter()` and the reference implementation of
 * the loop runtime contract.
 *
 * You script *model behavior* (text, tool calls, raw structured output); the
 * fake supplies honest contract mechanics. That honesty is what makes policy
 * tests written against it transfer to real SDKs.
 *
 * @param config - Scripts for each method; see {@link FakeLoopRuntimeConfig}.
 *
 * @example
 * ```ts
 * import { loopRuntimeAdapter } from '@use-crux/core/adapter'
 * import { fakeLoopRuntime } from '@use-crux/core/adapter/testing'
 *
 * const fake = fakeLoopRuntime({ structured: ['not json', '{"title":"ok","count":1}'] })
 * const executor = loopRuntimeAdapter(fake.runtime)
 *
 * const result = await executor.generate(myStructuredPrompt, {
 *   model: 'fake:m-1',
 *   input: { instruction: 'go' },
 *   validationRetry: { maxRetries: 2 },
 * })
 * expect(fake.calls.runStructuredAttempt).toHaveLength(2)
 * ```
 */
export function fakeLoopRuntime(
  config: FakeLoopRuntimeConfig = {},
): FakeLoopRuntime {
  const loops = [...(config.loops ?? [])];
  const structured = [...(config.structured ?? [])];
  const streams = [...(config.streams ?? [])];
  const calls: FakeLoopRuntime["calls"] = {
    runTextLoop: [],
    runStructuredAttempt: [],
    runStream: [],
  };
  const transformIndexes = new WeakMap<StepTransformer, number>();

  const transformContent = async (
    request: Pick<ExecutorRequest<string>, "stepTransformer">,
    content: readonly import("../../types/content").AssistantContentPart[],
  ) => {
    const transformer = request.stepTransformer;
    if (!transformer) return content;
    const index = transformIndexes.get(transformer) ?? 0;
    transformIndexes.set(transformer, index + 1);
    return transformCanonicalStep(transformer, { index, content });
  };

  const runtime: LoopRuntimePort<string, FakeRawResponse, FakeRawStream> = {
    id: "fake",
    capabilities: {
      requestPlanning: "per-step",
      stepTransform: "before-client-tools",
    },
    structuredOutput: { capabilities: () => FAKE_STRUCTURED_CAPABILITIES },

    describeModel(model: string): ModelInfo {
      const idx = model.indexOf(":");
      if (idx > 0)
        return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) };
      return { provider: "fake", modelId: model };
    },

    mapSettings(settings: GenerationSettings): Record<string, unknown> {
      return { ...settings };
    },

    async runTextLoop(request): Promise<ExecutorOutcome<FakeRawResponse>> {
      calls.runTextLoop.push(request);
      const script = loops.shift() ?? [{ text: "fake response" }];
      if (script instanceof Error) throw script;

      let system = request.system;
      let systemBlocks = request.systemBlocks;
      let tools = request.tools;
      let activeTools = request.activeTools;
      let messages: Message[] = [...(request.messages ?? [])];
      const reportedStepFacts: ResultStepFacts[] = [];
      if (messages.length === 0 && request.prompt) {
        messages = [{ role: "user", content: request.prompt }];
      }

      let steps = 0;
      let lastResponse: AdapterResponse = {
        text: "",
        toolCalls: undefined,
        usage: { ...FAKE_USAGE },
        finishReason: "stop",
        responseId: undefined,
        actualModelId: request.modelInfo.modelId,
      };

      for (let index = 0; index < script.length; index++) {
        if (steps >= request.maxSteps) break;
        steps++;
        const planned = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system,
          systemBlocks,
          messages,
        });
        await planned.validate?.();
        system = planned.system;
        systemBlocks = planned.systemBlocks;
        messages = [...planned.messages];
        const emission = script[index]!;
        const toolCalls = (emission.toolCalls ?? []).map((tc, j) => ({
          id: tc.id ?? `tc_${index}_${j}`,
          name: tc.name,
          args: tc.args,
        }));

        lastResponse = {
          text: emission.text ?? "",
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: { ...FAKE_USAGE },
          finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
          responseId: `fake_${index}`,
          actualModelId: request.modelInfo.modelId,
          ...(emission.transportRetries === undefined
            ? {}
            : { transportRetries: emission.transportRetries }),
        };
        const canonicalContent = responseContent(lastResponse);
        if (request.stepTransformer !== undefined) {
          const content = await transformContent(request, canonicalContent);
          lastResponse = {
            ...lastResponse,
            content,
            text: textFromAssistantContent(content),
          };
        }
        if (request.observer === undefined) {
          reportedStepFacts.push({
            request: planned.receipt,
            content: responseContent(lastResponse),
            usage: lastResponse.usage,
            ...(lastResponse.toolCalls
              ? { toolCalls: lastResponse.toolCalls }
              : {}),
            finishReason: lastResponse.finishReason,
            responseId: lastResponse.responseId,
            modelId: lastResponse.actualModelId,
            ...(lastResponse.transportRetries === undefined
              ? {}
              : { transportRetries: lastResponse.transportRetries }),
          });
        }

        if (toolCalls.length === 0) {
          messages = [
            ...messages,
            { role: "assistant", content: lastResponse.text },
          ];
          await request.observer?.onStepEnd({
            request: planned.receipt,
            index: steps - 1,
            text: lastResponse.text,
            content: lastResponse.content,
            toolCalls: [],
            toolResults: [],
            finishReason: "stop",
            usage: lastResponse.usage,
            transportRetries: lastResponse.transportRetries,
          });
          break;
        }

        // Approval scan first: a real SDK detects approval-gated tools before executing.
        for (const tc of toolCalls) {
          const tool = lookupTool(tools, activeTools, tc.name);
          if (
            tool &&
            (await request.toolApproval?.({
              toolName: tc.name,
              toolCallId: tc.id,
              input: tc.args,
              messages,
            }))
          ) {
            const pending: PendingToolApproval = {
              toolCallId: tc.id,
              toolName: tc.name,
              input: toJsonValue(tc.args),
            };
            return {
              status: "suspended",
              reason: "tool-approval",
              pendingApprovals: [pending],
              assistantResponse: lastResponse,
              messages,
              steps,
            };
          }
        }

        const toolResults: Array<{
          toolCallId: string;
          toolName: string;
          output: unknown;
        }> = [];
        const toolMessages: Message[] = [];
        for (const tc of toolCalls) {
          const tool = lookupTool(tools, activeTools, tc.name);
          let output: unknown;
          try {
            output = tool?.execute
              ? await tool.execute(tc.args, { toolCallId: tc.id, messages })
              : undefined;
          } catch (error) {
            output = {
              error: error instanceof Error ? error.message : String(error),
            };
          }
          toolResults.push({ toolCallId: tc.id, toolName: tc.name, output });
          const modelOutput = tool
            ? await createToolModelOutput({
                tool,
                toolCallId: tc.id,
                input: normalizeToolInput(tc.args),
                output,
              })
            : ({
                type: "error-json",
                value: { error: `Tool "${tc.name}" not found` },
              } as const);
          toolMessages.push({
            role: "tool",
            content: renderToolModelOutput(modelOutput),
            metadata: { toolCallId: tc.id, toolName: tc.name },
          });
        }

        messages = [
          ...messages,
          {
            role: "assistant",
            content: lastResponse.text,
            metadata: { toolCalls },
          },
          ...toolMessages,
        ];

        const directive: StepDirective = (await request.observer?.onStepEnd({
          request: planned.receipt,
          index: steps - 1,
          text: lastResponse.text,
          content: lastResponse.content,
          toolCalls,
          toolResults,
          finishReason: "tool_calls",
          usage: lastResponse.usage,
          transportRetries: lastResponse.transportRetries,
        })) ?? { kind: "continue" };

        if (directive.kind === "stop") break;
        if (directive.kind === "amend") {
          if (
            directive.system !== undefined ||
            directive.systemBlocks !== undefined
          ) {
            system = directive.system;
            systemBlocks = directive.systemBlocks;
          }
          if (directive[systemMessagePrefixPatch] !== undefined) {
            messages = applySystemMessagePrefixPatch(
              messages,
              directive[systemMessagePrefixPatch],
            );
          }
          if (directive.tools !== undefined) tools = directive.tools;
          if (directive.activeTools !== undefined)
            activeTools = directive.activeTools;
          if (directive.refundStep) steps--;
        }
      }

      return {
        status: "complete",
        raw: { kind: "fake-loop", text: lastResponse.text, system },
        response: lastResponse,
        messages,
        steps,
        ...(reportedStepFacts.length > 0
          ? { stepFacts: reportedStepFacts }
          : {}),
        meta: config.costUsd !== undefined ? { costUsd: config.costUsd } : {},
      };
    },

    async runStructuredAttempt(
      request,
    ): Promise<StructuredAttempt<FakeRawResponse>> {
      calls.runStructuredAttempt.push(request);
      const planned = await request.planStep!({
        model: request.model,
        modelInfo: request.modelInfo,
        system: request.system,
        systemBlocks: request.systemBlocks,
        messages:
          request.messages ??
          (request.prompt
            ? [{ role: "user" as const, content: request.prompt }]
            : []),
      });
      await planned.validate?.();
      const scripted = structured.shift() ?? "{}";
      if (scripted instanceof Error) throw scripted;

      const canonicalContent = await transformContent(request, [
        { type: "text", text: scripted },
      ]);
      const guardedText = textFromAssistantContent(canonicalContent);
      // A real SDK validates the completed text structurally against the
      // installed wire schema, not the authored Zod schema. The fake accepts
      // any well-formed JSON as its wire value; core owns the authored parse.
      const repaired = repairJsonText(guardedText) ?? guardedText;
      let wireValue: unknown;
      try {
        wireValue = JSON.parse(repaired);
      } catch (error) {
        return {
          status: "invalid",
          request: planned.receipt,
          rawText: guardedText,
          error: new ZodError([
            {
              code: "custom",
              path: [],
              message: error instanceof Error ? error.message : "Invalid JSON",
            },
          ]),
        };
      }
      return {
        status: "ok",
        request: planned.receipt,
        raw: {
          kind: "fake-structured",
          text: repaired,
          wireValue,
          system: request.system,
        },
        response: {
          text: repaired,
          toolCalls: undefined,
          usage: { ...FAKE_USAGE },
          finishReason: "stop",
          responseId: "fake_structured",
          actualModelId: request.modelInfo.modelId,
        },
        wireValue,
      };
    },

    async runStream(request): Promise<ExecutorProviderStreamHandle<FakeRawStream>> {
      calls.runStream.push(request);
      const planned = await request.planStep!({
        model: request.model,
        modelInfo: request.modelInfo,
        system: request.system,
        systemBlocks: request.systemBlocks,
        messages:
          request.messages ??
          (request.prompt
            ? [{ role: "user" as const, content: request.prompt }]
            : []),
      });
      await planned.validate?.();
      const scripted = streams.shift() ?? ["fake ", "stream"];

      // Drive the safety streaming sub-protocol exactly as a real port must:
      // feed deltas, forward emits, swallow holds, append the seal's pending
      // tail. Blocks reject the stream.
      let chunks: readonly string[] = scripted;
      if (request.safety) {
        const emitted: string[] = [];
        for (const chunk of scripted) {
          const directive = await request.safety.feed(chunk);
          if (directive.kind === "emit" && directive.content.length > 0)
            emitted.push(directive.content);
        }
        const seal = await request.safety.finish();
        if (seal.pending.length > 0) emitted.push(seal.pending);
        chunks = emitted;
      }

      const text = chunks.join("");
      // A structured stream (real `streamText` + `Output.object`) exposes the
      // parsed wire value as `output` on completion; the fake mirrors that by
      // structurally parsing the completed text. Core owns the authored parse.
      const structured = (request as { schema?: unknown }).schema !== undefined;
      let wireValue: unknown;
      if (structured) {
        const repaired = repairJsonText(text) ?? text;
        try {
          wireValue = JSON.parse(repaired);
        } catch {
          wireValue = undefined;
        }
      }
      return {
        raw: { kind: "fake-stream", chunks, text },
        completion: async () => ({
          requestReceipts: [planned.receipt],
          text,
          ...(structured ? { object: wireValue } : {}),
          usage: FAKE_USAGE,
          finishReason: "stop",
          streaming: { totalChunks: chunks.length, ttftMs: 1 },
        }),
      };
    },
  };

  return { runtime, calls };
}

function lookupTool(
  tools: Record<string, unknown> | undefined,
  activeTools: readonly string[] | undefined,
  name: string,
): FakeToolLike | undefined {
  if (!tools) return undefined;
  if (activeTools && !activeTools.includes(name)) return undefined;
  const tool = tools[name];
  return tool && typeof tool === "object" ? (tool as FakeToolLike) : undefined;
}
