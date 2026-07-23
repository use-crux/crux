/** Step-transform rules shared by loop-runtime conformance suites. @internal */

import { z } from "zod";
import { isPolicyTerminal } from "../../safety/errors";
import { compileStructuredOutput } from "../structured-output";
import type { ExecutorRequest } from "../executor-types";
import type { LoopRuntimePort } from "../loop-runtime-port";
import type {
  ConformanceViolation,
  LoopRuntimeConformanceHarness,
} from "./loop-runtime-conformance";

/** Verify every guarantee advertised by `before-client-tools`. */
export async function stepTransformConformance<TModel>(
  harness: LoopRuntimeConformanceHarness<TModel>,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = [];
  const fail = (rule: string, detail: string) =>
    violations.push({ rule, detail });
  const inputSchema = z.record(z.string(), z.unknown());

  {
    const events: string[] = [];
    const { runtime, model } = await harness.prepare({
      emissions: [
        { text: "unsafe", toolCalls: [{ name: "echo", args: {} }] },
        { text: "done" },
      ],
    });
    if (runtime.capabilities?.stepTransform !== "before-client-tools")
      return violations;
    const outcome = await runtime.runTextLoop(
      request(runtime, model, {
        tools: {
          echo: {
            description: "echo",
            inputSchema,
            execute: async () => {
              events.push("tool");
              return "ok";
            },
          },
        },
        stepTransformer: {
          transform: async (step) => {
            const text =
              step.content.find((part) => part.type === "text")?.text ?? "";
            events.push(`transform:${step.index}:${text}`);
            return text === "unsafe"
              ? [{ kind: "replace-text", partIndex: 0, text: "safe" }]
              : [];
          },
        },
        observer: {
          onStepEnd: async (step) => {
            events.push(`observer:${step.text}`);
            return { kind: "continue" };
          },
        },
      }),
    );
    const expected = [
      "transform:0:unsafe",
      "tool",
      "observer:safe",
      "transform:1:done",
      "observer:done",
    ];
    if (JSON.stringify(events) !== JSON.stringify(expected)) {
      fail(
        "step transform order",
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(events)}`,
      );
    }
    if (outcome.status !== "complete" || outcome.response.text !== "done") {
      fail(
        "step transform order",
        "guarded loop did not complete with its second response",
      );
    }
  }

  {
    let executed = false;
    let observed = false;
    let transforms = 0;
    const { runtime, model } = await harness.prepare({
      emissions: [
        { text: "blocked", toolCalls: [{ name: "echo", args: {} }] },
        { text: "unreachable" },
      ],
    });
    try {
      await runtime.runTextLoop(
        request(runtime, model, {
          tools: {
            echo: {
              description: "echo",
              inputSchema,
              execute: async () => {
                executed = true;
                return "bad";
              },
            },
          },
          stepTransformer: {
            transform: async () => {
              transforms++;
              throw new Error("transform failure");
            },
          },
          observer: {
            onStepEnd: async () => {
              observed = true;
              return { kind: "continue" };
            },
          },
        }),
      );
      fail(
        "terminal transform failure",
        "expected transformer failure to reject",
      );
    } catch (error) {
      if (!isPolicyTerminal(error))
        fail("terminal transform failure", "failure was not policy-terminal");
    }
    if (transforms !== 1 || executed || observed) {
      fail(
        "terminal transform failure",
        `expected one transform and no tool/observer, got transforms=${transforms}, tool=${executed}, observer=${observed}`,
      );
    }
  }

  {
    let executed = false;
    const { runtime, model } = await harness.prepare({
      emissions: [{ toolCalls: [{ name: "echo", args: {} }] }],
    });
    try {
      await runtime.runTextLoop(
        request(runtime, model, {
          tools: {
            echo: {
              description: "echo",
              inputSchema,
              execute: async () => {
                executed = true;
                return "bad";
              },
            },
          },
          stepTransformer: {
            transform: async () => [{ kind: "remove", partIndex: 0 }],
          },
        }),
      );
      fail("immutable tool-call parts", "expected tool-call edit to reject");
    } catch (error) {
      if (!isPolicyTerminal(error))
        fail(
          "immutable tool-call parts",
          "invalid edit was not policy-terminal",
        );
    }
    if (executed)
      fail(
        "immutable tool-call parts",
        "tool executed after its part was targeted by an edit",
      );
  }

  {
    const { runtime, model } = await harness.prepare({
      structuredTexts: ["unsafe invalid json"],
    });
    const schema = z.object({ ok: z.boolean() });
    const caps = runtime.structuredOutput?.capabilities(
      runtime.describeModel(model),
    );
    const attempt = await runtime.runStructuredAttempt({
      ...request(runtime, model, {
        stepTransformer: {
          transform: async () => [
            { kind: "replace-text", partIndex: 0, text: "guarded invalid json" },
          ],
        },
      }),
      schema,
      outputSchema: caps
        ? compileStructuredOutput(schema, caps).outputSchema
        : undefined,
    });
    if (attempt.status !== "invalid") {
      fail("guarded structured correction", "expected invalid structured output");
    } else if (attempt.rawText !== "guarded invalid json") {
      fail(
        "guarded structured correction",
        `expected guarded corrective text, got ${JSON.stringify(attempt.rawText)}`,
      );
    }
  }

  return violations;
}

function request<TModel>(
  runtime: LoopRuntimePort<TModel>,
  model: TModel,
  overrides: Partial<ExecutorRequest<TModel>>,
): ExecutorRequest<TModel> {
  return {
    model,
    modelInfo: runtime.describeModel(model),
    system: undefined,
    systemBlocks: undefined,
    prompt: "run step transform conformance",
    messages: undefined,
    settings: {},
    tools: undefined,
    activeTools: undefined,
    maxSteps: 10,
    observer: undefined,
    abortSignal: undefined,
    extra: undefined,
    ...overrides,
  };
}
