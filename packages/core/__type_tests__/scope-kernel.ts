import {
  createScopeFacetSlot,
  openScope,
  runScope,
  type ScopeFacetSlot,
} from "../src/scope/internal";

type AssertEqual<T, U> = [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;
type Expect<T extends true> = T;

const requestSlot = createScopeFacetSlot<{ readonly requestId: string }>(
  "type-test.request",
);
const controller = openScope({ kind: "invocation" }, {});
controller.scope.setFacet(requestSlot, { requestId: "request-1" });

// @ts-expect-error Facet values retain the slot's exact value contract.
controller.scope.setFacet(requestSlot, { requestId: 42 });

// @ts-expect-error ScopeFacetSlot is nominal and cannot be forged structurally.
const forgedSlot: ScopeFacetSlot<string> = { debugName: "forged" };
void forgedSlot;

const result = runScope({ kind: "tool" }, {}, async () => ({
  ok: true as const,
}));
type _RunScopeAwaitsHandlerResult = Expect<
  AssertEqual<typeof result, Promise<{ ok: true }>>
>;
