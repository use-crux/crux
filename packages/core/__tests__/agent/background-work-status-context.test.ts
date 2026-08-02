import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
  type ToolResultEntry,
} from "../../src";
import { agent, backgroundable } from "../../src/agent";

function response(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: unknown }>,
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

it("projects background Work status only at the next sealed provider boundary", async () => {
  let releaseChild!: () => void;
  const childGate = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  let childProviderReturned = false;
  let workId: string | undefined;
  let parentCalls = 0;
  let parentPreparations = 0;

  const child = agent({
    id: "status-context-child",
    model: "child-model",
    description: "Research one topic",
    prompt: prompt({
      id: "status-context-child-prompt",
      input: z.object({ topic: z.string() }),
      prompt: ({ input }) => input.topic,
    }),
  });
  const parent = agent({
    id: "status-context-parent",
    prompt: prompt({ id: "status-context-parent-prompt", prompt: () => "parent" }),
    tools: { research: backgroundable(child) },
    prepareStep() {
      parentPreparations += 1;
    },
  });

  const spec: AdapterSpec<object, object> = {
    providerId: "status-context-recording",
    async call(_client, args) {
      if (args.model === "child-model") {
        await childGate;
        childProviderReturned = true;
        return { raw: {}, extracted: response("PRIVATE CHILD RESULT") };
      }

      parentCalls += 1;
      if (parentCalls === 1) {
        expect(args.system ?? "").not.toContain("Background work:");
        return {
          raw: {},
          extracted: response("", [{
            id: "start-background-work",
            name: "research",
            args: { topic: "boundary", run_in_background: true },
          }]),
        };
      }

      if (parentCalls === 2) {
        const activeSystem = args.system ?? "";
        expect(activeSystem).toContain("Background work:");
        expect(activeSystem).toContain("research");
        expect(activeSystem).toMatch(/queued|running/);
        expect(activeSystem).not.toContain("PRIVATE CHILD RESULT");
        expect(Object.isFrozen(args)).toBe(true);

        releaseChild();
        await vi.waitFor(() => expect(childProviderReturned).toBe(true));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(args.system ?? "").toBe(activeSystem);
        expect(args.system ?? "").not.toContain("completed");
        expect(parentPreparations).toBe(2);
        return {
          raw: {},
          extracted: response("", [{
            id: "inspect-background-work",
            name: "work",
            args: { action: "status", id: workId },
          }]),
        };
      }

      expect(args.system ?? "").toContain("Background work:");
      expect(args.system ?? "").toContain("research");
      expect(args.system ?? "").toContain("completed");
      expect(args.system ?? "").toContain("Result available");
      expect(args.system ?? "").not.toContain("PRIVATE CHILD RESULT");
      return { raw: {}, extracted: response("parent finished") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, _assistant, results: ToolResultEntry[]) {
      const output = record(results[0]?.output);
      if (results[0]?.name === "research" && typeof output?.id === "string") {
        workId = output.id;
      }
      return messages;
    },
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "background-work-status-context",
    context: {},
    agents: { parent },
    model: "parent-model",
  });

  expect(result.results.parent.output).toBe("parent finished");
  expect(workId).toEqual(expect.any(String));
  expect(parentPreparations).toBe(3);
});
