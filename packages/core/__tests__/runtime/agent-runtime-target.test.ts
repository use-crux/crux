import { describe, expect, it } from "vitest";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import type {
  RuntimeProgram,
  RuntimeProgramTargetDefinitionInput,
  RuntimeTarget,
  RuntimeTargetId,
  TaskId,
} from "@use-crux/core/runtime";

import { normalizeRuntimeHandlerTargets } from "../../src/runtime/handler/targets";

describe("Agent RuntimeProgram target", () => {
  it("normalizes a frozen hand-written Agent target through the existing resolver", () => {
    const target = Object.freeze({
      targetId: "support-agent" as RuntimeTargetId,
      kind: "agent" as const,
      async execute() {
        return { status: "completed" as const, output: "resolved" };
      },
    }) satisfies RuntimeTarget;
    const program = Object.freeze({
      manifestHash: "agent-program-v1",
      targets: Object.freeze([target]),
      targetDefinitions: Object.freeze([
        Object.freeze({
          targetId: target.targetId,
          definitionId: "agent:support-agent",
          fingerprint: "support-agent-v1",
        }),
      ]),
      transports: Object.freeze([]),
    }) satisfies RuntimeProgram;

    const targets = normalizeRuntimeHandlerTargets({
      targets: program.targets,
      runtimeRef: {},
      entry: "Agent RuntimeProgram test",
    });

    expect(targets[target.targetId]).toBe(target);
    expect(targets[target.targetId]?.kind).toBe("agent");
  });

  it("keeps Agent program declarations and definition metadata immutable", () => {
    const target = Object.freeze({
      targetId: "immutable-agent" as RuntimeTargetId,
      kind: "agent" as const,
      async execute() {
        return { status: "completed" as const };
      },
    }) satisfies RuntimeTarget;

    const program = createRuntimeProgram({
      targets: [
        {
          target,
          definition: {
            id: "agent:immutable-agent",
            fingerprint: "immutable-agent-v1",
          },
        },
      ],
      transports: [],
    });

    expect(Object.isFrozen(program)).toBe(true);
    expect(Object.isFrozen(program.targets)).toBe(true);
    expect(Object.isFrozen(program.targetDefinitions)).toBe(true);
    expect(Object.isFrozen(program.targetDefinitions[0])).toBe(true);
  });

  it("requires an Agent definition fingerprint for later selection", () => {
    const target = Object.freeze({
      targetId: "versioned-agent" as RuntimeTargetId,
      kind: "agent" as const,
      async execute() {
        return { status: "completed" as const };
      },
    }) satisfies RuntimeTarget;

    expect(() =>
      createRuntimeProgram({
        targets: [
          {
            target,
            definition: {
              id: "agent:versioned-agent",
            } as RuntimeProgramTargetDefinitionInput,
          },
        ],
        transports: [],
      }),
    ).toThrow(/definition fingerprint/i);
  });

  it("loads an Agent target in the existing worker claim path", async () => {
    const seen: string[] = [];
    const target = Object.freeze({
      targetId: "worker-agent" as RuntimeTargetId,
      kind: "agent" as const,
      async execute({ work }: Parameters<RuntimeTarget["execute"]>[0]) {
        if (work.work.kind === "task.run") seen.push(String(work.work.input));
        return { status: "completed" as const };
      },
    }) satisfies RuntimeTarget;
    const program = Object.freeze({
      manifestHash: "worker-agent-program-v1",
      targets: Object.freeze([target]),
      targetDefinitions: Object.freeze([
        Object.freeze({
          targetId: target.targetId,
          definitionId: "agent:worker-agent",
          fingerprint: "worker-agent-v1",
        }),
      ]),
      transports: Object.freeze([]),
    }) satisfies RuntimeProgram;
    const worker = createRuntimeWorker({
      runtime: node({
        store: inMemoryRuntimeStore(),
        namespace: "agent-worker-test",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });

    await worker.runtime.kernel.enqueueTask({
      namespace: "agent-worker-test",
      taskId: "task_agent_worker" as TaskId,
      targetId: target.targetId,
      input: "claimed",
    });

    await expect.poll(() => seen).toEqual(["claimed"]);
    await worker.stop();
  });
});
