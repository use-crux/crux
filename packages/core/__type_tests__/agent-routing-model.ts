/**
 * Compile-time contract for routed agent models.
 */

import { expectTypeOf } from "vitest";
import { z } from "zod";
import { agent, type RoutableModel } from "../src/agent";
import { prompt } from "../src/prompt";
import { router, type RouteArgs } from "../src/routing";

interface RawModel {
  readonly modelId: string;
}

declare const fast: RawModel;
declare const smart: RawModel;

const supportPrompt = prompt({
  id: "agent-routing",
  input: z.object({ instruction: z.string() }),
  system: "Answer the request.",
});

const agentModel = router({
  classify: ({ context }: RouteArgs<{ readonly agent: { readonly id: string; readonly phase: string } }>) =>
    context.agent.phase === "tool-summary" ? "fast" : "smart",
  routes: {
    fast,
    smart,
    default: smart,
  },
});

const routedAgent = agent({
  id: "support-agent",
  prompt: supportPrompt,
  model: agentModel,
});

expectTypeOf(routedAgent.model).toMatchTypeOf<RoutableModel<RawModel> | undefined>();
