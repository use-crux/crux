import { describe, expect, it } from "vitest";
import * as scope from "@use-crux/core/internal/scope";

describe("execution scope internal surface", () => {
  it("exports the coordinated first-party kernel SPI", () => {
    expect(scope).toEqual(
      expect.objectContaining({
        ScopeSealedError: expect.any(Function),
        createHandlerReturnedDeferLifetime: expect.any(Function),
        createResponseFinishedDeferLifetime: expect.any(Function),
        createScopeFacetSlot: expect.any(Function),
        currentScope: expect.any(Function),
        currentScopeStack: expect.any(Function),
        openScope: expect.any(Function),
        resolveConfiguredHost: expect.any(Function),
        resolveWritableScope: expect.any(Function),
        runScope: expect.any(Function),
        runWithDeferInvocation: expect.any(Function),
        runWithScopeFacet: expect.any(Function),
        whenRootIdle: expect.any(Function),
      }),
    );
  });
});
