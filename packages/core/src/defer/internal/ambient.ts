import type { CruxHostBinding } from "../../scope/types";
import { bindRootRetention } from "../../scope/state";
import { openScope } from "../../scope/kernel";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import type { DeferredCallback, DeferredWorkRef } from "../types";
import { createInvocationDeferServices } from "./invocation-services";
import { createScopeDeferController } from "./invocation-scope";

/** Open one binding-owned ephemeral root for an ambient inline registration. */
export function registerAmbientInlineDefer(
  binding: CruxHostBinding,
  callback: DeferredCallback,
): void {
  const root = createAmbientRoot(binding, false);
  root.scope.run(() => {
    root.controller.registerInline(callback, {
      scope: root.controller,
      phase: "handler",
      depth: 0,
    });
  });
  root.scope.seal("success");
}

/** Stage one ambient named registration; the caller's await is its barrier. */
export async function registerAmbientNamedDefer(
  binding: CruxHostBinding,
  target: RuntimeTaskTarget,
  input: unknown,
): Promise<DeferredWorkRef> {
  const root = createAmbientRoot(binding, true);
  try {
    const work = await root.scope.run(() =>
      root.controller.stageNamed(target, input),
    );
    root.scope.seal("success");
    return work;
  } catch (error) {
    root.scope.seal("error");
    throw error;
  }
}

function createAmbientRoot(
  binding: CruxHostBinding,
  acceptanceMode: boolean,
): {
  readonly scope: ReturnType<typeof openScope>;
  readonly controller: ReturnType<typeof createScopeDeferController>;
} {
  const scope = openScope({ kind: "invocation" }, {});
  bindRootRetention(scope.scope, binding);
  const services = createInvocationDeferServices(scope.scope, binding, {
    acceptanceMode,
  });
  return {
    scope,
    controller: createScopeDeferController(scope.scope, services),
  };
}
