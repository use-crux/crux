/** Shared conformance for backgroundable Agent Work and automatic control. */

import { z } from "zod";
import { agent, backgroundable } from "../../agent";
import type { createParallel } from "../../agent/parallel";
import { prompt as makePrompt } from "../../prompt";
import type { ConformanceViolation } from "../testing";
import type {
  ProviderConformancePrepared,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
} from "./provider-runtime-types";

const CHILD_TOOL_NAME = "backgroundChild";
const WORK_TOOL_NAME = "work";
const CHILD_INPUT = { request: "Run the background child." } as const;
const CHILD_OUTPUT = "private background child output";
const PARENT_OUTPUT = "parent completed after inspecting work";

type RuntimeWithParallel<TModel> = ProviderRuntimeConformanceRuntime<TModel> & {
  readonly parallel: ReturnType<typeof createParallel>;
};

/** Run one provider-neutral background Agent and Work-control round trip. */
export async function providerRuntimeBackgroundWorkConformance<
  TClient,
  TModel,
  TDeps extends Record<string, unknown>,
  TRuntime extends ProviderRuntimeConformanceRuntime<TModel>,
>(
  harness: ProviderRuntimeConformanceHarness<TClient, TModel, TDeps>,
  bind: (
    prepared: ProviderConformancePrepared<TClient, TModel, TDeps>,
  ) => TRuntime,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = [];
  const fail = (detail: string) =>
    violations.push({ rule: "background Agent work", detail });

  try {
    const prepared = await harness.prepare({
      emissions: [
        {
          text: "",
          toolCalls: [{
            id: "call_background_child",
            name: CHILD_TOOL_NAME,
            args: { ...CHILD_INPUT, run_in_background: true },
          }],
        },
        { text: CHILD_OUTPUT },
        {
          text: "",
          toolCalls: [{
            id: "call_list_work",
            name: WORK_TOOL_NAME,
            args: { action: "list" },
          }],
        },
        { text: PARENT_OUTPUT },
      ],
    });
    const runtime = bind(prepared);
    if (!hasParallel(runtime)) {
      fail("provider runtime does not expose the parallel Agent executor");
      return violations;
    }

    const child = agent({
      id: "crux-provider-conformance-background-child",
      model: prepared.model,
      description: "Runs one background child request.",
      prompt: makePrompt({
        id: "crux-provider-conformance-background-child-prompt",
        input: z.object({ request: z.string() }),
        prompt: ({ input }) => input.request,
      }),
    });
    const parent = agent({
      id: "crux-provider-conformance-background-parent",
      prompt: makePrompt({
        id: "crux-provider-conformance-background-parent-prompt",
        prompt: () => "Start the child, then inspect its Work status.",
      }),
      tools: { [CHILD_TOOL_NAME]: backgroundable(child) },
    });

    const result = await runtime.parallel({
      id: "crux-provider-conformance-background-work-run",
      context: {},
      agents: { parent },
      model: prepared.model,
    });
    if (result.results.parent.output !== PARENT_OUTPUT) {
      fail(
        `expected parent output ${JSON.stringify(PARENT_OUTPUT)}, got ${JSON.stringify(result.results.parent.output)}`,
      );
    }

    const calls = prepared.inspect?.calls();
    if (!calls) {
      fail("provider harness did not expose captured calls");
      return violations;
    }
    if (calls.length !== 4) {
      fail(`expected exactly 4 provider calls, got ${calls.length}`);
      return violations;
    }

    const initial = JSON.stringify(calls[0]);
    for (const expected of [
      `"${CHILD_TOOL_NAME}"`,
      '"run_in_background"',
      `"${WORK_TOOL_NAME}"`,
      '"list"',
      '"status"',
      '"result"',
      '"cancel"',
      '"detach"',
    ]) {
      if (!initial.includes(expected)) {
        fail(`initial provider request omitted stable Work schema value ${expected}`);
      }
    }

    if (!containsString(calls[1], CHILD_INPUT.request)) {
      fail("background child request did not receive its authored input");
    }
    if (!containsString(calls[2], "work.ref")) {
      fail("parent continuation did not receive the background Work reference");
    }
    if (!containsString(calls[2], "Background work:")) {
      fail("parent continuation did not receive safe boundary status context");
    }

    if (!containsString(calls[3], "resultAvailable")) {
      fail("Work list result did not round-trip a safe status projection");
    }
    if (
      containsString(calls[2], CHILD_OUTPUT) ||
      containsString(calls[3], CHILD_OUTPUT)
    ) {
      fail("background child output leaked without an explicit result action");
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  return violations;
}

function hasParallel<TModel>(
  runtime: ProviderRuntimeConformanceRuntime<TModel>,
): runtime is RuntimeWithParallel<TModel> {
  return "parallel" in runtime && typeof runtime.parallel === "function";
}

function containsString(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value.includes(expected);
  if (Array.isArray(value)) {
    return value.some((entry) => containsString(entry, expected));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some((entry) => containsString(entry, expected));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
