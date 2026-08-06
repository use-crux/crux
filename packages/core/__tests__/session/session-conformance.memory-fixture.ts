import {
  config,
  createWorkHost,
  getSession,
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
import type { SessionConformanceHarness } from "@use-crux/core/runtime/testing";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { vi } from "vitest";
import { z } from "zod";
import { adapter, type AdapterSpec } from "../../src/adapter";
import type { AdapterResponse } from "../../src/adapter/types";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { effect } from "../../src/effect";
import {
  managedGenerationCheckpoint,
  managedGenerationStepBoundary,
} from "../../src/generation-model/execution-checkpoint";
import { permissiveCapabilities } from "../adapter/structured-output/capability-fixtures";

/** Build the memory reference implementation for one shared Session law. */
export function createMemorySessionConformanceHarness(
  id: string,
): SessionConformanceHarness {
  const effectHandler = vi.fn(async () => "effect-result");
  const recordEffect = effect(`session.conformance.${id}`, effectHandler);
  const tool = vi.fn(async () => {
    await recordEffect();
    return "tool-result";
  });
  let activeMessage = "";
  const provider = vi.fn(async () => {
    const call = provider.mock.calls.length;
    return call % 2 === 1
      ? adapterResponse("Checking", [
          { id: `conformance-${call}`, name: "check", args: {} },
        ])
      : adapterResponse(JSON.stringify({ reply: `Echo: ${activeMessage}` }));
  });
  const runtime = adapter(conformanceSpec(provider))({});
  const execute = vi.fn<AgentExecutor>(async (target, options) => {
    const input = options.input;
    if (!isConformanceInput(input))
      throw new Error("Invalid conformance input");
    if (input.message === "private-failure") {
      throw new Error("Session conformance failure.");
    }
    activeMessage = input.message;
    const result = await runtime.generate(target.prompt, {
      model: "session-conformance-model",
      input,
      tools: { ...target.tools, ...options.tools },
      maxSteps: 2,
      prepareStep: options.prepareStep ?? target.prepareStep,
      [managedGenerationCheckpoint]: options[managedGenerationCheckpoint],
      [managedGenerationStepBoundary]: options[managedGenerationStepBoundary],
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
    native: Object.freeze({ id: "session-conformance-model" }),
    definition: { id: `test:session-conformance:${id}`, fingerprint: "v1" },
    identity: { kind: "model", model: `session-conformance-${id}` },
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
  const primary = agent({
    id: `session-conformance-primary-${id}`,
    model,
    prompt: prompt({
      input: z.object({ message: z.string() }),
      output: z.object({ reply: z.string() }),
      prompt: ({ input }) => input.message,
    }),
    tools: {
      check: {
        description: "Exercise managed Tool and Effect recovery.",
        execute: tool,
      },
    },
    prepareStep: () => ({ inputBudget: { max: 100_000 } }),
  });
  const conflicting = agent({
    id: `session-conformance-conflict-${id}`,
    model,
    prompt: primary.prompt,
  });
  const incompatibleModel = defineGenerationModel({
    adapter: { id: "test", version: "1" },
    native: Object.freeze({ id: "session-conformance-text-only" }),
    definition: {
      id: `test:session-conformance-text-only:${id}`,
      fingerprint: "v1",
    },
    identity: { kind: "model", model: `session-conformance-text-only-${id}` },
    capabilities: {
      contract: "crux.generation-capabilities.v1",
      language: ["text-input", "text-output"],
      embedding: [],
      image: [],
      speech: [],
      transcription: [],
    },
    runtime: { createAgentExecutor: () => execute },
  });
  const unsupported = agent({
    id: `session-conformance-unsupported-${id}`,
    model: incompatibleModel,
    prompt: prompt({
      input: z.object({ message: z.string() }),
      output: z.object({ reply: z.string() }),
      prompt: ({ input }) => input.message,
    }),
  });
  const program = createRuntimeProgram({
    targets: [primary, conflicting, unsupported],
    transports: [],
  });
  const store = inMemoryRuntimeStore();
  const records = inMemoryRecordStore();
  const namespace = `session-conformance-${id}`;
  const createHost = () => {
    config({ storage: { records } });
    return createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
    });
  };
  let host = createHost();

  return {
    create: (key) => host.run(() => session(primary, { key })),
    get: (key) => host.run(() => getSession(primary, key)),
    createConflict: (key) => host.run(() => session(conflicting, { key })),
    createCapabilityFailure: async (key) =>
      await host.run(() =>
        Reflect.apply(session, undefined, [unsupported, { key }]),
      ),
    ownerIds: async (threadId) => {
      const control = await records.get(`thread/${threadId}`);
      const owners = control?.owners;
      return owners && typeof owners === "object" && !Array.isArray(owners)
        ? Object.keys(owners)
        : [];
    },
    startWorker: () =>
      createRuntimeWorker({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
        pollIntervalMs: 1,
      }),
    armFault: (boundary) => {
      if (boundary === "after-checkpoint") {
        store.testing.crashAfterSessionTurnCheckpoint();
      } else {
        store.testing.crashAfterSessionThreadPublication();
      }
    },
    reconnect: () => {
      host.dispose();
      host = createHost();
    },
    receiptCount: async (threadId) =>
      (
        await records.list(`thread/${threadId}/receipt/`, {
          limit: 100,
        })
      ).entries.length,
    makeTerminalFailure: async () => {
      const pending = await store.state.listWork({
        namespace,
        status: "pending",
      });
      const [work] = pending;
      if (!work || pending.length !== 1) {
        throw new Error("Expected one pending Session Work.");
      }
      await store.state.putWork(Object.freeze({ ...work, maxAttempts: 1 }));
    },
    sessionCount: () => store.testing.sessionRecords(namespace).length,
    executionCounts: () => ({
      executor: execute.mock.calls.length,
      provider: provider.mock.calls.length,
      tool: tool.mock.calls.length,
      effect: effectHandler.mock.calls.length,
    }),
    dispose: () => host.dispose(),
  };
}

function isConformanceInput(
  value: unknown,
): value is { readonly message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function conformanceSpec(
  provider: () => Promise<AdapterResponse>,
): AdapterSpec<object, object, never> {
  return {
    providerId: "session-conformance",
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
