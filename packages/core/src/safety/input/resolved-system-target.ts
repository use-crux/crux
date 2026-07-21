/** Exact target validation for resolver-owned system ingress. */

import type { Message } from "../../generation/messages";
import { joinSystemText } from "../../resolver/adaptation";
import type {
  ResolvedSystemIngressCarrier,
  SystemIngressBlock,
} from "../../resolver/system-ingress-provenance";
import { SafetyResultError } from "../errors";
import type { GuardrailBinding } from "../registry";

/** Validate the raw carrier boundary before any policy callback can run. */
export function resolveSystemIngressTarget(
  input: {
    readonly carrier: ResolvedSystemIngressCarrier;
    readonly messages: readonly Message[];
    readonly system?: string;
  },
  mismatchBinding: GuardrailBinding | undefined,
): {
  readonly content: string;
  readonly prefix: string;
  readonly suffix: string;
} {
  const expectedSystem = joinSystemText(
    input.carrier.blocks.map((block) => block.text),
  );
  if (input.carrier.mode === "system") {
    if (input.system !== expectedSystem) mismatch(mismatchBinding);
    return {
      content: input.system ?? "",
      prefix: expectedSystem,
      suffix: "",
    };
  }

  const message = input.messages[input.carrier.targetMessageIndex];
  const content =
    message?.role === "system" && typeof message.content === "string"
      ? message.content
      : undefined;
  const prefixMatches =
    content !== undefined &&
    input.carrier.prefixLength === input.carrier.foldedPrefix.length &&
    content.slice(0, input.carrier.prefixLength) === input.carrier.foldedPrefix;
  if (!prefixMatches) mismatch(mismatchBinding);
  return {
    content: content ?? "",
    prefix: expectedSystem,
    suffix: prefixMatches ? content!.slice(input.carrier.prefixLength) : "",
  };
}

/** Read the privacy-safe retriever identifier owned by the resolver. */
export function systemIngressRetrieverId(block: SystemIngressBlock): string {
  const id = block.contextId ?? block.source;
  return id.startsWith("retriever:") ? id.slice("retriever:".length) : id;
}

function mismatch(binding: GuardrailBinding | undefined): never {
  throw new SafetyResultError({
    policyId: binding?.policy.id ?? "model-ingress",
    boundary: binding?.boundary.id ?? "model.instructions",
    problem: "resolved system ingress no longer matches its folded prefix",
    message:
      "Resolved system content changed after provenance was captured, so Safety could not write guarded retrieval and instruction contributions back exactly.",
  });
}
