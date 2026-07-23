/**
 * Request-time compilation surfaces lowering diagnostics.
 *
 * `compileStructuredOutputForRequest` must emit every plan diagnostic through the
 * provided sink with the stable code, canonical path, prompt id, and compilation
 * fingerprint, and must stay silent for a clean compilation.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { compileStructuredOutputForRequest } from "../../../src/adapter/structured-output";
import { permissiveCapabilities } from "./capability-fixtures";

describe("compileStructuredOutputForRequest — diagnostics surfacing", () => {
  it("emits one diagnostic per lowering decision with stable code and fingerprint", () => {
    const warn = vi.fn();
    const schema = z.object({ tag: z.string().min(2) });

    const plan = compileStructuredOutputForRequest(
      schema,
      { ...permissiveCapabilities, unsupportedKeywords: ["minLength"] },
      { diagnostics: { warn }, promptId: "p-1" },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, detail] = warn.mock.calls[0]!;
    expect(message).toContain("dropped-unsupported-keyword");
    expect(detail).toMatchObject({
      code: "dropped-unsupported-keyword",
      promptId: "p-1",
      fingerprint: plan.fingerprint,
    });
  });

  it("stays silent when nothing is lowered", () => {
    const warn = vi.fn();
    compileStructuredOutputForRequest(
      z.object({ name: z.string() }),
      permissiveCapabilities,
      { diagnostics: { warn }, promptId: "p-2" },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("compiles without a diagnostics sink", () => {
    const plan = compileStructuredOutputForRequest(
      z.object({ name: z.string() }),
      permissiveCapabilities,
      {},
    );
    expect(plan.outputSchema).toMatchObject({ type: "object" });
  });
});
