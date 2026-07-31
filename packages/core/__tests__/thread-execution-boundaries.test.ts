import { describe, expect, it } from "vitest";
import { adapter, loopRuntimeAdapter, type AdapterSpec } from "../src/adapter";
import { fakeLoopRuntime } from "../src/adapter/testing";
import { prompt } from "../src/prompt";
import { inMemoryStorage } from "../src/storage";
import { thread } from "../src/thread";
import type { GenerateRegime } from "./cache/semantic-cache-generate-safety.fixtures";
import { response } from "./thread-execution-fixtures";

const regimes: readonly GenerateRegime[] = ["core", "sdk"];

describe.each(regimes)("thread managed turn boundaries — %s", (regime) => {
  it("does not synthesize a user message for an empty current turn", async () => {
    const conversation = thread({
      id: `assistant-only-${regime}`,
      storage: inMemoryStorage(),
    });
    await conversation.append([
      { id: "prior-user", role: "user", content: "Prior question" },
      { id: "prior-assistant", role: "assistant", content: "Prior answer" },
    ]);
    const answer = prompt({
      id: `assistant-only-answer-${regime}`,
      use: [conversation],
      prompt: "",
    });

    await generate(regime, answer);

    expect(projectMessages((await conversation.read()).entries)).toEqual([
      ["user", "Prior question"],
      ["assistant", "Prior answer"],
      ["assistant", "Accepted answer"],
    ]);
  });

  it("publishes one complete tool round when maxSteps ends the loop", async () => {
    const conversation = thread({
      id: `tool-budget-${regime}`,
      storage: inMemoryStorage(),
    });
    const answer = prompt({
      id: `tool-budget-answer-${regime}`,
      use: [conversation],
      prompt: "Check the weather",
    });

    await generateCompleteToolRound(regime, answer);

    const entries = (await conversation.read()).entries;
    expect(entries).toHaveLength(3);
    expect(entries).toMatchObject([
      { role: "user", content: "Check the weather" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking" },
          {
            type: "tool-call",
            toolCallId: "weather-1",
            toolName: "weather",
          },
        ],
      },
      {
        role: "tool",
        metadata: { toolCallId: "weather-1", toolName: "weather" },
      },
    ]);
  });
});

async function generate(
  regime: GenerateRegime,
  answer: ReturnType<typeof prompt>,
): Promise<void> {
  if (regime === "core") {
    await adapter(simpleSpec())({}).generate(answer as never, {
      model: "test-model",
    });
    return;
  }
  await loopRuntimeAdapter(
    fakeLoopRuntime({ loops: [[{ text: "Accepted answer" }]] }).runtime,
  ).generate(answer as never, { model: "fake:test-model" });
}

async function generateCompleteToolRound(
  regime: GenerateRegime,
  answer: ReturnType<typeof prompt>,
): Promise<void> {
  const tools = {
    weather: {
      description: "Get weather",
      execute: () => "18°C",
    },
  };
  if (regime === "sdk") {
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            text: "Checking",
            toolCalls: [
              {
                id: "weather-1",
                name: "weather",
                args: { city: "Amsterdam" },
              },
            ],
          },
        ],
      ],
    });
    await loopRuntimeAdapter(fake.runtime).generate(answer as never, {
      model: "fake:test-model",
      maxSteps: 1,
      tools,
    });
    return;
  }
  await adapter(toolSpec())({}).generate(answer as never, {
    model: "test-model",
    maxSteps: 1,
    tools,
  });
}

function simpleSpec(): AdapterSpec<object, object, never> {
  return {
    providerId: "thread-boundary-test",
    async call() {
      return { raw: {}, extracted: response("Accepted answer") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  };
}

function toolSpec(): AdapterSpec<object, object, never> {
  return {
    ...simpleSpec(),
    async call() {
      return {
        raw: {},
        extracted: response("Checking", [
          {
            id: "weather-1",
            name: "weather",
            args: { city: "Amsterdam" },
          },
        ]),
      };
    },
    appendToolRound(messages, assistant, results) {
      return [
        ...messages,
        {
          role: "assistant",
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...results.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: {
            toolCallId: result.toolCallId,
            toolName: result.name,
          },
        })),
      ];
    },
  };
}

function projectMessages(
  entries: readonly {
    readonly kind: string;
    readonly role?: string;
    readonly content?: unknown;
  }[],
): Array<[string, string]> {
  return entries.map((entry) => [
    entry.role ?? entry.kind,
    typeof entry.content === "string"
      ? entry.content
      : Array.isArray(entry.content)
        ? entry.content
            .flatMap((part) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string"
                ? [part.text]
                : [],
            )
            .join("")
        : "",
  ]);
}
