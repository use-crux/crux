/** Compile the public Agent Work handle and spawn overloads. */

import { expectTypeOf } from "vitest";
import {
  createAgentWorkHost,
  createWorkHost,
  flow,
  spawn,
  type AgentWorkHandle,
  type CreateAgentWorkHostOptions,
  type CreateWorkHostOptions,
  type WorkHandle,
  type WorkSteeringReceipt,
} from "@use-crux/core";
import { agent } from "@use-crux/core/agent";
import { prompt } from "@use-crux/core";
import { z } from "zod";

const review = flow(
  "review-document",
  async (_scope, input: { readonly documentId: string }) =>
    ({
      documentId: input.documentId,
    }) as const,
);

const researcher = agent({
  id: "researcher",
  description: "Research one topic",
  prompt: prompt({
    id: "researcher-prompt",
    input: z.object({ task: z.string() }),
    output: z.object({ findings: z.string() }),
    prompt: ({ input }) => input.task,
  }),
});

declare const agentHandle: AgentWorkHandle<{ findings: string }>;
declare const flowHandle: WorkHandle<{ documentId: string }>;

expectTypeOf(agentHandle.send).toBeFunction();
expectTypeOf(agentHandle.send("Prioritize primary sources.")).toEqualTypeOf<
  Promise<WorkSteeringReceipt>
>();
expectTypeOf(
  agentHandle.send([{ type: "text", text: "Also inspect this screenshot." }]),
).toEqualTypeOf<Promise<WorkSteeringReceipt>>();
expectTypeOf(agentHandle.result()).toEqualTypeOf<
  Promise<{ findings: string }>
>();

// @ts-expect-error — Flow Work handles do not expose Agent-only send.
flowHandle.send;
// @ts-expect-error — Flow Work handles do not expose Agent-only send.
flowHandle.send("nope");

declare const hostOptions: CreateWorkHostOptions;
expectTypeOf(createWorkHost(hostOptions)).toHaveProperty("run");

declare const agentHostOptions: CreateAgentWorkHostOptions;
const agentHost = createAgentWorkHost(agentHostOptions);
const spawnedAgent = await agentHost.run(() =>
  spawn(researcher, { task: "Investigate the regression." }),
);
expectTypeOf(spawnedAgent).toEqualTypeOf<
  AgentWorkHandle<{ findings: string }>
>();
expectTypeOf(spawnedAgent.send).toBeFunction();

declare const spawnedFlow: WorkHandle<{ documentId: string }>;
expectTypeOf(spawnedFlow).toEqualTypeOf<WorkHandle<{ documentId: string }>>();
// @ts-expect-error — Flow Work handles do not expose Agent-only send.
spawnedFlow.send("nope");
