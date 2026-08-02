/**
 * Shared conformance scenario for direct foreground Agent-as-Tool execution.
 *
 * @module
 */

import { z } from "zod";
import { agent } from "../../agent";
import type { createParallel } from "../../agent/parallel";
import { prompt as makePrompt } from "../../prompt";
import type { ConformanceViolation } from "../testing";
import type {
  ProviderConformancePrepared,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
} from "./provider-runtime-types";

const PARENT_INPUT = { request: "Ask the child for its exact answer." } as const;
const CHILD_INPUT = { request: "Return the private child answer." } as const;
const CHILD_PROMPT_TEXT = `Child request: ${CHILD_INPUT.request}`;
const CHILD_OUTPUT = "exact child answer";
const PARENT_OUTPUT = "parent completed from child result";
const CHILD_TOOL_KEY = "directChild";

type ProviderRuntimeWithParallel<TModel> =
  ProviderRuntimeConformanceRuntime<TModel> & {
    readonly parallel: ReturnType<typeof createParallel>;
  };

const childPrompt = makePrompt({
  id: "crux-provider-conformance-agent-tool-child",
  system: "Answer only the child request.",
  prompt: ({ input }) => `Child request: ${input.request}`,
  input: z.object({ request: z.string() }),
});

const parentPrompt = makePrompt({
  id: "crux-provider-conformance-agent-tool-parent",
  system: "Delegate the request and complete from the Tool result.",
  prompt: ({ input }) => input.request,
  input: z.object({ request: z.string() }),
});

/**
 * Runs the foreground Agent Tool conformance scenario against a provider harness.
 *
 * @param harness Provider-owned fake SDK bridge and capability configuration.
 * @param bind Creates the provider runtime from prepared fake SDK state.
 * @returns Conformance violations; an empty array indicates success.
 */
export async function providerRuntimeAgentToolsConformance<
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
    violations.push({ rule: "foreground agent tool", detail });

  try {
    const prepared = await harness.prepare({
      emissions: [
        {
          text: "",
          toolCalls: [
            {
              id: "call_direct_child",
              name: CHILD_TOOL_KEY,
              args: CHILD_INPUT,
            },
          ],
        },
        { text: CHILD_OUTPUT },
        { text: PARENT_OUTPUT },
      ],
    });
    const runtime = bind(prepared);
    if (!hasParallel(runtime)) {
      fail("provider runtime does not expose the parallel Agent executor");
      return violations;
    }
    const child = agent({
      id: "crux-provider-conformance-direct-child",
      description: "Returns the exact answer for a delegated child request.",
      prompt: childPrompt,
    });
    const parent = agent({
      id: "crux-provider-conformance-agent-tool-parent",
      description: "Delegates one request to its direct child Tool.",
      prompt: parentPrompt,
      tools: { [CHILD_TOOL_KEY]: child },
    });

    const result = await runtime.parallel({
      id: "crux-provider-conformance-agent-tool-run",
      context: PARENT_INPUT,
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
    if (calls.length !== 3) {
      fail(`expected exactly 3 provider calls, got ${calls.length}`);
      return violations;
    }

    if (!containsString(calls[1], CHILD_INPUT.request)) {
      fail("child request did not receive the child input value");
    }
    if (!containsExactString(calls[1], CHILD_PROMPT_TEXT)) {
      fail("child request did not receive the resolved child prompt text");
    }
    if (containsExactString(calls[0], CHILD_PROMPT_TEXT)) {
      fail("resolved child prompt text leaked into the initial parent request");
    }

    const parentContinuation = calls[2];
    if (!containsExactString(parentContinuation, CHILD_OUTPUT)) {
      fail("parent continuation did not receive the exact child output");
    }
    if (containsExactString(parentContinuation, CHILD_PROMPT_TEXT)) {
      fail("child prompt text leaked into the parent continuation");
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  return violations;
}

function hasParallel<TModel>(
  runtime: ProviderRuntimeConformanceRuntime<TModel>,
): runtime is ProviderRuntimeWithParallel<TModel> {
  return "parallel" in runtime && typeof runtime.parallel === "function";
}

function containsExactString(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) {
    return value.some((entry) => containsExactString(entry, expected));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some((entry) =>
    containsExactString(entry, expected),
  );
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
