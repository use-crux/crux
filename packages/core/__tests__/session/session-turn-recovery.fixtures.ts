import {
  config,
  createWorkHost,
  prompt,
  session,
} from "@use-crux/core";
import { agent, type AgentExecutor } from "@use-crux/core/agent";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { vi } from "vitest";
import { z } from "zod";
import { adapter, type AdapterSpec } from "../../src/adapter";
import type { AdapterResponse } from "../../src/adapter/types";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { effect } from "../../src/effect";
import { managedGenerationCheckpoint } from "../../src/generation-model/execution-checkpoint";
import { permissiveCapabilities } from "../adapter/structured-output/capability-fixtures";

/** Build one real managed Session turn with provider, Tool, and Effect evidence. */
export async function createSessionRecoveryFixture(id: string) {
  const effectHandler = vi.fn(async () => "effect-result");
  const recordEffect = effect(`session.recovery.${id}`, effectHandler);
  const tool = vi.fn(async () => {
    await recordEffect();
    return "tool-result";
  });
  const provider = vi.fn(async () =>
    provider.mock.calls.length === 1
      ? adapterResponse("Checking", [
          { id: "recover-1", name: "recover", args: {} },
        ])
      : adapterResponse('{"reply":"Echo: Hello"}'),
  );
  const runtime = adapter(recoverySpec(provider))({});
  const execute = vi.fn<AgentExecutor>(async (target, options) => {
    const result = await runtime.generate(target.prompt, {
      model: "recovery-model",
      input: options.input as Record<string, unknown>,
      tools: { ...target.tools, ...options.tools },
      maxSteps: 2,
      [managedGenerationCheckpoint]: options[managedGenerationCheckpoint],
    });
    return {
      agentId: target.id,
      output: result.object ?? result.text,
      durationMs: 1,
      threadCommit: result.threadCommit,
    };
  });
  const model = defineGenerationModel({
    adapter: { id: "test", version: "1" },
    native: Object.freeze({ id: "recovery-model" }),
    definition: { id: `test:recovery-model:${id}`, fingerprint: "recovery-v1" },
    identity: { kind: "model", model: `recovery-model-${id}` },
    capabilities: {
      contract: "crux.generation-capabilities.v1",
      language: [
        "text-input",
        "text-output",
        "structured-output",
        "tool-calls",
      ],
      embedding: [],
      image: [],
      speech: [],
      transcription: [],
    },
    runtime: { createAgentExecutor: () => execute },
  });
  const support = agent({
    id: `session-turn-recovery-${id}`,
    model,
    prompt: prompt({
      input: z.object({ message: z.string() }),
      output: z.object({ reply: z.string() }),
      prompt: ({ input }) => input.message,
    }),
    tools: {
      recover: {
        description: "Exercise one managed tool and Effect.",
        execute: tool,
      },
    },
  });
  const program = createRuntimeProgram({
    targets: [
      {
        target: support,
        definition: { id: `agent:session-turn-recovery:${id}`, fingerprint: "v1" },
      },
    ],
    transports: [],
  });
  const store = inMemoryRuntimeStore();
  const records = inMemoryRecordStore();
  const namespace = `session-turn-recovery-${id}`;
  config({ storage: { records } });
  const host = createWorkHost({
    runtime: node({ store, namespace, autoStartMaintenance: false }),
    program,
  });
  const conversation = await host.run(() =>
    session(support, { key: `customer-recovery-${id}` }),
  );
  const turn = await conversation.send({ message: "Hello" });

  return {
    conversation,
    effectHandler,
    execute,
    host,
    namespace,
    provider,
    records,
    store,
    tool,
    turn,
    startWorker: () =>
      createRuntimeWorker({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
        pollIntervalMs: 1,
      }),
  };
}

function recoverySpec(
  provider: () => Promise<AdapterResponse>,
): AdapterSpec<object, object, never> {
  return {
    providerId: "session-recovery",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      return { raw: {}, extracted: await provider() };
    },
    async stream() {
      throw new Error("not used");
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
    mapSettings: (settings) => ({ ...settings }),
  };
}

function adapterResponse(
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
