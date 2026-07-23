import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("completion call identity", () => {
  it("pins every completion call to the shared producer identity manifest", () => {
    const identities = producerIdentities
      .filter(
        (identity) =>
          identity.matchKind === "call" &&
          completionCallNames.has(identity.name),
      )
      .flatMap((identity) =>
        identity.importFrom.map((module) => `${identity.name}:${module}`),
      )
      .sort();

    expect(identities).toEqual([
      "agent:@use-crux/core/agent",
      "cascade:@use-crux/core/routing",
      "context:@use-crux/core",
      "fallback:@use-crux/core",
      "fallback:@use-crux/core/routing",
      "prompt:@use-crux/core",
      "retry:@use-crux/core/routing",
      "router:@use-crux/core/routing",
      "split:@use-crux/core/routing",
      "tool:@use-crux/core",
      "tool:@use-crux/core/tools",
    ]);
  });
});

interface ProducerIdentity {
  readonly matchKind: "call" | "new";
  readonly name: string;
  readonly importFrom: readonly string[];
}

const producerIdentities = JSON.parse(
  readFileSync(
    new URL(
      "../../../crates/primitives/src/producer_identities.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as readonly ProducerIdentity[];

const completionCallNames = new Set([
  "agent",
  "cascade",
  "context",
  "fallback",
  "prompt",
  "retry",
  "router",
  "split",
  "tool",
]);

type CoreModule = typeof import("@use-crux/core");
type AgentModule = typeof import("@use-crux/core/agent");
type RoutingModule = typeof import("@use-crux/core/routing");
type ToolsModule = typeof import("@use-crux/core/tools");

const coreCompletionExports = [
  "context",
  "fallback",
  "prompt",
  "tool",
] as const satisfies readonly (keyof CoreModule)[];
const agentCompletionExports = [
  "agent",
] as const satisfies readonly (keyof AgentModule)[];
const routingCompletionExports = [
  "cascade",
  "fallback",
  "retry",
  "router",
  "split",
] as const satisfies readonly (keyof RoutingModule)[];
const toolsCompletionExports = [
  "tool",
] as const satisfies readonly (keyof ToolsModule)[];

void [
  coreCompletionExports,
  agentCompletionExports,
  routingCompletionExports,
  toolsCompletionExports,
];
