/**
 * Tool-schema projection and canonical tool-round shaping.
 *
 * The per-call tool lifecycle (`session.ts`) delegates the pure, stateless parts
 * of tool preparation here: compiling each tool's authored schema to a wire
 * schema and wrapping `execute` with one decode + authored validation
 * (`prepareToolInputPlans`), projecting core-regime descriptors from the compiled
 * wire schemas (`convertTools`), building canonical tool-round messages, and the
 * small middleware/provenance normalizers. Everything here is a pure function of
 * its inputs; all per-call mutable state stays in the lifecycle closure.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import type { ToolMiddleware } from "../../tools/types";
import { isToolExecutionMock } from "../../tools/mock";
import {
  toolSourceProvenance,
  withToolSourceProvenance,
} from "../../tools/tool-source";
import type { StructuredOutputCapabilities } from "../structured-output";
import type { AdapterResponse, ToolResultEntry } from "../types";
import { responseContent } from "../assistant-output";
import {
  compileToolInputPlan,
  CruxToolInputValidationError,
  decodeToolArgs,
  type ToolInputPlan,
} from "./tool-input";
import type { ToolDescriptor } from "./session";

/**
 * Compile each tool's input schema and, for tools that declared an authored
 * validator (a Zod schema, or an AI SDK schema with its own `validate`), wrap
 * the authored `execute` with the single authored-validation boundary. This is
 * the innermost layer: the input it receives is already canonical `z.input`
 * (decoded by {@link withToolInputDecode} and possibly rewritten by middleware),
 * so the authored tool runs on the validated/transformed value. Invalid
 * arguments raise {@link CruxToolInputValidationError} at the execution
 * boundary, which the lifecycle settles as a model-visible tool error. Raw JSON
 * Schema tools carry no authored validator (the provider validates
 * structurally). The compiled plans (wire schema + decode manifest) are stored
 * by tool name for the descriptor, the decode boundary, and gate-time decoding.
 */
export function prepareToolInputPlans(
  registry: Record<string, unknown>,
  capabilities: StructuredOutputCapabilities,
  passthrough: boolean,
  plans: Map<string, ToolInputPlan>,
): Record<string, unknown> {
  plans.clear();
  // Build via entries + `Object.fromEntries` so a tool literally named
  // `__proto__` stays an own property instead of mutating the prototype.
  const entries = Object.entries(registry).map(([name, tool]) => {
    if (!tool || typeof tool !== "object") {
      return [name, tool] as const;
    }
    const t = tool as {
      readonly parameters?: unknown;
      readonly inputSchema?: unknown;
      readonly execute?: (input: unknown, options: unknown) => unknown;
    };
    // Core tools declare `parameters`; AI SDK tools declare `inputSchema`. Both
    // are the authored schema core lowers to a wire schema and retains as the
    // sole validator.
    const authoredSchema = t.parameters ?? t.inputSchema;
    let plan: ToolInputPlan;
    try {
      plan = compileToolInputPlan(authoredSchema, capabilities, passthrough);
    } catch (error) {
      throw new Error(`Tool "${name}": failed to compile input schema`, {
        cause: error,
      });
    }
    plans.set(name, plan);

    const validate = plan.validate;
    if (validate && typeof t.execute === "function") {
      const authored = t.execute;
      const wrapped = {
        ...t,
        execute: async (input: unknown, executeOptions: unknown) => {
          const outcome = await validate(input);
          if (!outcome.ok) {
            throw new CruxToolInputValidationError(name, outcome.issues);
          }
          return authored(outcome.value, executeOptions);
        },
      };
      return [name, wrapped] as const;
    }
    return [name, tool] as const;
  });
  return Object.fromEntries(entries);
}

/**
 * The outer decode boundary: decode the model's wire arguments to canonical
 * `z.input` before middleware and the authored `safeParse` run. This is what
 * lets approval, policies, and middleware observe canonical input in the
 * SDK-owned tool loop, which never passes through the core `gate()`. Decoding is
 * idempotent, so it is safe to also run for the core regime, whose gate already
 * decoded. A decode failure ({@link CruxStructuredOutputDecodeError}) throws at
 * the boundary and settles as a model-visible decode error without executing.
 */
export function withToolInputDecode(
  tools: Record<string, unknown>,
  plans: Map<string, ToolInputPlan>,
): Record<string, unknown> {
  const entries = Object.entries(tools).map(([name, tool]) => {
    const plan = plans.get(name);
    if (
      !plan ||
      plan.manifest.operations.length === 0 ||
      !tool ||
      typeof tool !== "object"
    ) {
      return [name, tool] as const;
    }
    const t = tool as {
      readonly execute?: (input: unknown, options: unknown) => unknown;
    };
    if (typeof t.execute !== "function") return [name, tool] as const;
    const inner = t.execute;
    return [
      name,
      {
        ...t,
        execute: (input: unknown, executeOptions: unknown) =>
          inner(decodeToolArgs(input, plan), executeOptions),
      },
    ] as const;
  });
  return Object.fromEntries(entries);
}

/** Whether any tool in the registry declared an input schema (Zod or JSON). */
export function registryHasAuthoredToolSchema(
  registry: Record<string, unknown>,
): boolean {
  for (const tool of Object.values(registry)) {
    if (!tool || typeof tool !== "object") continue;
    const t = tool as { parameters?: unknown; inputSchema?: unknown };
    if (t.parameters !== undefined || t.inputSchema !== undefined) return true;
  }
  return false;
}

/** Project core-regime provider descriptors from the compiled wire schemas. */
export function convertTools(
  resolvedTools: Record<string, unknown> | undefined,
  plans: Map<string, ToolInputPlan>,
  sanitizeToolSchema?: (
    schema: Record<string, unknown>,
  ) => Record<string, unknown>,
): ToolDescriptor[] | undefined {
  if (!resolvedTools || Object.keys(resolvedTools).length === 0)
    return undefined;

  return Object.entries(resolvedTools).map(([name, tool]) => {
    const t = tool as {
      description?: string;
      parameters?: unknown;
      execute?: ToolDescriptor["execute"];
      toModelOutput?: ToolDescriptor["toModelOutput"];
    };

    // Use the pre-compiled provider-compatible wire schema.
    let parameters: Record<string, unknown> =
      (plans.get(name)?.wireSchema as Record<string, unknown> | undefined) ??
      (t.parameters && typeof t.parameters === "object"
        ? (t.parameters as Record<string, unknown>)
        : {});

    // Apply provider-specific schema sanitization (e.g. Anthropic descriptions).
    if (sanitizeToolSchema) {
      parameters = sanitizeToolSchema(parameters);
    }

    return {
      name,
      description: t.description ?? "",
      parameters,
      execute: t.execute ?? (() => undefined),
      toModelOutput: t.toModelOutput,
    };
  });
}

/** Build the canonical tool-round messages (the sdk regime's only shape). */
export function canonicalAppendToolRound(
  messages: Message[],
  response: AdapterResponse,
  results: ToolResultEntry[],
): Message[] {
  return [
    ...messages,
    {
      role: "assistant" as const,
      content: responseContent(response),
      ...(response.toolCalls
        ? { metadata: { toolCalls: response.toolCalls } }
        : {}),
    },
    ...results.map(canonicalToolResultMessage),
  ];
}

/** Canonical single tool-result message. */
export function canonicalToolResultMessage(result: ToolResultEntry): Message {
  return {
    role: "tool" as const,
    content: result.content,
    metadata: {
      toolCallId: result.toolCallId,
      toolName: result.name,
      modelOutput: result.modelOutput,
      ...(result.modelOutputError !== undefined
        ? { modelOutputError: result.modelOutputError }
        : {}),
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    },
  };
}

/** Flatten prompt-level and call-level middleware into one ordered chain. */
export function normalizeMiddlewareChain(
  promptMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
  callMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): readonly ToolMiddleware[] {
  return [
    ...(Array.isArray(promptMiddleware)
      ? promptMiddleware
      : promptMiddleware
        ? [promptMiddleware]
        : []),
    ...(Array.isArray(callMiddleware)
      ? callMiddleware
      : callMiddleware
        ? [callMiddleware]
        : []),
  ];
}

/** Preserve discovered origin when an explicit Eval mock shadows execution. */
export function inheritMockSourceProvenance(
  resolvedTools: Readonly<Record<string, unknown>> | undefined,
  callTools: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!callTools) return undefined;
  const inherited = { ...callTools };
  for (const [name, callTool] of Object.entries(inherited)) {
    if (
      !isToolExecutionMock(callTool) ||
      typeof callTool !== "object" ||
      callTool === null
    ) {
      continue;
    }
    const provenance = toolSourceProvenance(resolvedTools?.[name]);
    if (provenance) withToolSourceProvenance(callTool, provenance);
  }
  return inherited;
}
