/** Runtime target adapter for canonical Agent Session turns. */

import { agent, type AnyAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import type { GenerationModelResolver } from "../generation-model/resolver";
import { generationRuntime } from "../generation-model/runtime-port";
import { prompt } from "../prompt";
import type { RuntimeTargetRuntimeRef } from "../runtime/api/target-registry";
import type {
  RuntimeTarget,
  RuntimeTargetContext,
  RuntimeTargetOutcome,
} from "../runtime/engine/kernel-types";
import type { RuntimeTargetId } from "../runtime/ports/ids";
import { resolveRecords } from "../runtime/runtime";
import type { JsonValue, Storage } from "../storage";
import { createThreadHandle } from "../thread/thread";

/** Adapt one statically imported Agent into the existing Runtime worker path. */
export function createSessionAgentRuntimeTarget(
  target: AnyAgent,
  runtimeRef: RuntimeTargetRuntimeRef,
  resolveGenerationModel: GenerationModelResolver,
): RuntimeTarget {
  return Object.freeze({
    targetId: target.id as RuntimeTargetId,
    kind: "agent" as const,
    async execute(context: RuntimeTargetContext): Promise<RuntimeTargetOutcome> {
      const turn = context.work.work;
      if (turn.kind !== "session.turn") return blocked(target.id, turn.kind);
      const model = resolveModel(target, turn.model, resolveGenerationModel);
      const runtime = runtimeRef.current;
      if (!runtime?.store.results || !runtime.store.sessions) {
        throw new Error("Session Agent execution requires result and Session storage.");
      }
      const ownerThread = createThreadHandle(
        {
          id: turn.threadId,
          storage: Object.freeze({ records: resolveRecords() }) as Storage,
        },
        { id: turn.sessionId, state: "open" },
      );
      const boundPrompt = prompt({
        ...target.prompt.config,
        use: Object.freeze([...target.prompt.contexts, ownerThread]),
      } as never);
      const boundAgent = agent({
        ...target,
        prompt: boundPrompt,
        model,
      } as never);
      const result = await model[generationRuntime].createAgentExecutor()(
        boundAgent,
        { input: turn.input, model },
      );
      const resultRef = await runtime.store.results.put(
        result.output as JsonValue,
        { namespace: context.work.namespace },
      );
      await runtime.store.sessions.park(
        context.work.namespace,
        turn.sessionId,
        runtime.now(),
      );
      return { status: "completed", resultRef };
    },
  });
}

function resolveModel(
  target: AnyAgent,
  reference: { readonly definitionId: string; readonly fingerprint: string },
  resolveGenerationModel: GenerationModelResolver,
): GenerationModel {
  const model = resolveGenerationModel(reference) ?? target.model;
  if (isGenerationModel(model) &&
    model.definition.id === reference.definitionId &&
    model.definition.fingerprint === reference.fingerprint
  ) {
    return model;
  }
  throw new Error(`Agent "${target.id}" cannot resolve the selected model.`);
}

function isGenerationModel(value: unknown): value is GenerationModel {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "crux.generation-model"
  );
}

function blocked(agentId: string, kind: string): RuntimeTargetOutcome {
  return {
    status: "blocked",
    error: {
      code: "TARGET_NOT_FOUND",
      message: `Agent "${agentId}" cannot execute Work kind "${kind}".`,
      at: new Date(),
    },
  };
}
