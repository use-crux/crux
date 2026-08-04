import { describe, expect, it, vi } from "vitest";
import type { ExecutorGenerateOptions } from "../../src";
import {
  defineGenerationModel,
  managedGenerationStepBoundary,
  type ManagedGenerationStepBoundary,
  type ManagedGenerationStepBoundaryInput,
  type ManagedGenerationStepBoundaryResult,
  type ManagedGenerationStepIngress,
} from "../../src/adapter-authoring";

describe("defineGenerationModel", () => {
  it("exposes the Session step boundary hook to adapter executors", () => {
    const stepBoundary: ManagedGenerationStepBoundary = async (
      _input: ManagedGenerationStepBoundaryInput,
    ): Promise<ManagedGenerationStepBoundaryResult> => {
      const ingress: ManagedGenerationStepIngress = {
        id: "ingress",
        cursor: 0,
        input: {},
      };
      return { inputs: [ingress] };
    };
    const options: ExecutorGenerateOptions<string> = {
      model: "fixture-model",
      [managedGenerationStepBoundary]: stepBoundary,
    };

    expect(options[managedGenerationStepBoundary]).toBe(stepBoundary);
  });

  it("freezes Core metadata and installs opaque runtime authority", () => {
    const createAgentExecutor = vi.fn(() => {
      throw new Error("not executed");
    });
    const runtime = { createAgentExecutor };
    const native = { middleware: vi.fn() };

    const model = defineGenerationModel({
      adapter: { id: "fixture", version: "1" },
      native,
      definition: { id: "fixture:route", fingerprint: "fixture:route:v1" },
      identity: {
        kind: "router",
        router: "quality",
        routes: [{ key: "default", target: "fixture-leaf" }],
      },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output"],
        image: [],
        speech: [],
        transcription: [],
        embedding: [],
      },
      runtime,
    });

    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.adapter)).toBe(true);
    expect(Object.isFrozen(model.definition)).toBe(true);
    expect(Object.isFrozen(model.identity)).toBe(true);
    expect(Object.isFrozen(model.capabilities)).toBe(true);
    expect(Object.isFrozen(model.capabilities.language)).toBe(true);
    if (model.identity.kind !== "router")
      throw new Error("expected router identity");
    expect(Object.isFrozen(model.identity.routes)).toBe(true);
    expect(Object.isFrozen(model.identity.routes[0])).toBe(true);

    expect(model.native).toBe(native);
    expect(Object.isFrozen(native)).toBe(false);
    const authorityKeys = Object.getOwnPropertySymbols(model);
    expect(authorityKeys).toHaveLength(1);
    expect(Reflect.get(model, authorityKeys[0]!)).toBe(runtime);
    expect(
      Object.getOwnPropertyDescriptor(model, authorityKeys[0]!),
    ).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: false,
    });
  });
});
