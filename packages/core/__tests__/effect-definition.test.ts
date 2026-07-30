import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CruxEffectError,
  effect,
  type EffectExecutionContext,
} from "../src/effect/index";
import {
  registerEffectDefinitionForTesting,
  resetEffectDefinitionsForTesting,
} from "../src/effect/define-effect";

describe("effect definitions", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("returns the executor output unchanged from the callable form", async () => {
    const send = vi.fn(
      async (input: { readonly message: string }) => ({
        accepted: input.message,
      }),
    );
    const sendMessage = effect("message.send", send);

    await expect(sendMessage({ message: "hello" })).resolves.toEqual({
      accepted: "hello",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("exposes the stable id, version, and definition brand", () => {
    const defaultVersion = effect("message.default", async () => undefined);
    const versioned = effect(
      "message.versioned",
      async () => undefined,
      { version: 3 },
    );

    expect(defaultVersion.id).toBe("message.default");
    expect(defaultVersion.version).toBe(1);
    expect(defaultVersion._tag).toBe("EffectDefinition");
    expect(versioned.version).toBe(3);
  });

  it("rejects a different definition for the same id and version", () => {
    effect("message.duplicate", async () => "first");

    expect(() =>
      effect("message.duplicate", async () => "second"),
    ).toThrowError(
      expect.objectContaining<Partial<CruxEffectError>>({
        code: "EFFECT_DUPLICATE_ID",
      }),
    );
  });

  it("collapses re-registration of the same definition object", () => {
    const definition = effect(
      "message.reexported",
      async () => "same",
    );

    expect(registerEffectDefinitionForTesting(definition)).toBe(definition);
    expect(registerEffectDefinitionForTesting(definition)).toBe(definition);
  });

  it("returns an implicit-root receipt from run()", async () => {
    let context: EffectExecutionContext | undefined;
    const create = effect(
      "customer.create",
      async (
        input: { readonly customerId: string },
        executionContext,
      ) => {
        context = executionContext;
        return { customerId: input.customerId };
      },
    );

    const execution = await create.run({ customerId: "customer_1" });

    expect(execution.output).toEqual({ customerId: "customer_1" });
    expect(execution.receipt).toEqual({
      kind: "effect.receipt",
      id: context?.receiptId,
      effectId: "customer.create",
    });
    expect(context?.scope).toEqual({
      kind: "effect.scope",
      id: expect.stringMatching(/^effect-root:/),
      runId: expect.stringMatching(/^effect-root:/),
    });
    expect(context?.idempotencyKey).toMatch(/^effect-execution:/);
  });

  it("rethrows the original executor error", async () => {
    const original = new Error("provider rejected the request");
    const fail = effect("customer.fail", async () => {
      throw original;
    });

    await expect(fail.run()).rejects.toBe(original);
  });

  it("keeps later recovery operations unavailable from the public module", async () => {
    const recoverable = effect(
      "customer.recoverable",
      async () => "created",
      { recover: async () => undefined },
    );

    await expect(
      recoverable.recover({
        kind: "effect.receipt",
        id: "receipt_1",
        effectId: "customer.recoverable",
      }),
    ).rejects.toMatchObject({
      code: "EFFECT_RECOVERY_HANDLER_UNAVAILABLE",
      message: expect.stringContaining("not implemented in this slice yet"),
    });
  });
});
