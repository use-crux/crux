import { describe, expect, it } from "vitest";
import {
  adapter,
  loopRuntimeAdapter,
  type AdapterSpec,
} from "../src/adapter";
import { fakeLoopRuntime } from "../src/adapter/testing";
import type { CallArgs } from "../src/adapter/types";
import type { Message } from "../src/generation/messages";
import { memory, memoryBlock } from "../src/memory";
import { prompt } from "../src/prompt";
import { boundary, guardrail, type Guardrail } from "../src/safety";
import { inMemoryStorage } from "../src/storage";
import { thread } from "../src/thread";
import type { GenerateRegime } from "./cache/semantic-cache-generate-safety.fixtures";
import { response } from "./thread-execution-fixtures";

const regimes: readonly GenerateRegime[] = ["core", "sdk"];

describe.each(regimes)("thread managed Safety parity — %s", (regime) => {
  it("commits the post-Safety user message the provider saw", async () => {
    const conversation = thread({
      id: `safe-user-${regime}`,
      storage: inMemoryStorage(),
    });
    const answer = prompt({
      id: `safe-user-answer-${regime}`,
      use: [conversation],
      prompt: "private user message",
    });
    const policy = guardrail({
      id: "rewrite-thread-user",
      on: boundary.input.text({ from: "user" }),
      run: (text) => ({
        action: "rewrite",
        value: text.replace("private", "safe"),
        rewrite: { kind: "redact" },
      }),
    });

    const { request } = await runGenerate(regime, answer, [policy]);

    expect(JSON.stringify(request.messages)).toContain("safe user message");
    expect(JSON.stringify(request.messages)).not.toContain(
      "private user message",
    );
    expect(JSON.stringify(await conversation.read())).toContain(
      "safe user message",
    );
    expect(JSON.stringify(await conversation.read())).not.toContain(
      "private user message",
    );
  });

  it("commits the accepted post-Safety assistant output", async () => {
    const conversation = thread({
      id: `safe-assistant-${regime}`,
      storage: inMemoryStorage(),
    });
    const answer = prompt({
      id: `safe-assistant-answer-${regime}`,
      use: [conversation],
      prompt: "Answer",
    });
    const policy = guardrail({
      id: "rewrite-thread-assistant",
      on: boundary.output.text(),
      run: (text) => ({
        action: "rewrite",
        value: text.replace("private", "safe"),
        rewrite: { kind: "redact" },
      }),
    });

    const { result } = await runGenerate(
      regime,
      answer,
      [policy],
      "private answer",
    );

    expect(result.text).toBe("safe answer");
    expect(JSON.stringify(await conversation.read())).toContain("safe answer");
    expect(JSON.stringify(await conversation.read())).not.toContain(
      "private answer",
    );
  });

  it("rebases folded system provenance after exact Thread history", async () => {
    const conversation = thread({
      id: `folded-ingress-${regime}`,
      storage: inMemoryStorage(),
    });
    await conversation.append([
      { id: "prior-user", role: "user", content: "Prior question" },
      {
        id: "prior-assistant",
        role: "assistant",
        content: "Prior answer",
      },
    ]);
    const notes = memory({
      id: `folded-memory-${regime}`,
      namespace: `folded-memory-${regime}`,
      blocks: [
        memoryBlock({
          id: "summary",
          kind: "custom",
          render: () => "private recalled memory",
        }),
      ],
    });
    const answer = prompt({
      id: `folded-ingress-answer-${regime}`,
      use: [conversation, notes],
      messages: () => [
        { role: "system", content: "Trusted suffix." },
        { role: "user", content: "Current question" },
      ],
    });
    const policy = guardrail({
      id: "rewrite-folded-thread-memory",
      on: boundary.input.text({ from: "memory" }),
      run: (text) => ({
        action: "rewrite",
        value: text.replace("private", "safe"),
        rewrite: { kind: "redact" },
      }),
    });

    const { request } = await runGenerate(regime, answer, [policy]);

    expect(JSON.stringify(request.messages)).toContain("safe recalled memory");
    expect(JSON.stringify(request.messages)).not.toContain(
      "private recalled memory",
    );
  });
});

interface CapturedRequest {
  readonly system?: string;
  readonly messages?: readonly Message[];
}

async function runGenerate(
  regime: GenerateRegime,
  answer: ReturnType<typeof prompt>,
  guardrails: readonly Guardrail[],
  output = "Accepted answer",
): Promise<{
  readonly request: CapturedRequest;
  readonly result: { readonly text: string };
}> {
  if (regime === "core") {
    const requests: CallArgs[] = [];
    const spec: AdapterSpec<object, object, never> = {
      providerId: "thread-safety-test",
      async call(_client, args) {
        requests.push(args);
        return { raw: {}, extracted: response(output) };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: (settings) => ({ ...settings }),
    };
    const result = await adapter(spec)({}).generate(answer as never, {
      model: "test-model",
      guardrails,
    });
    return { request: requests[0]!, result };
  }

  const fake = fakeLoopRuntime({ loops: [[{ text: output }]] });
  const result = await loopRuntimeAdapter(fake.runtime).generate(
    answer as never,
    {
      model: "fake:test-model",
      guardrails,
    },
  );
  return {
    request: fake.calls.runTextLoop[0] as CapturedRequest,
    result,
  };
}
