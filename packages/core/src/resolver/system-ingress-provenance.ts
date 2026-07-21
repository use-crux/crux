/** Private resolver provenance for semantic system-message ingress. @internal */

import type { CruxContextInjectableKind } from "../observability/contract";
import type { ResolvedPrompt, SystemBlock } from "./types";

/** One exact resolver-owned contribution in provider delivery order. */
export interface SystemIngressBlock {
  readonly source: string;
  readonly text: string;
  readonly family?: CruxContextInjectableKind;
  readonly contextId?: string;
}

interface SystemIngressCarrierBase {
  readonly blocks: readonly SystemIngressBlock[];
}

/** Provenance for a standalone provider system string. */
export interface SystemIngressCarrier extends SystemIngressCarrierBase {
  readonly mode: "system";
}

/** Provenance for a composed prefix folded into one system message. */
export interface FoldedSystemIngressCarrier extends SystemIngressCarrierBase {
  readonly mode: "messages";
  readonly targetMessageIndex: number;
  readonly foldedPrefix: string;
  readonly prefixLength: number;
  readonly hasTrustedSuffix: boolean;
}

/** Exact private handoff consumed by managed Safety execution. */
export type ResolvedSystemIngressCarrier =
  | SystemIngressCarrier
  | FoldedSystemIngressCarrier;

const systemIngressCarrier: unique symbol = Symbol(
  "crux.resolver.systemIngress",
);

/** Attach provenance without changing public keys, spreads, or serialization. */
export function attachSystemIngressCarrier(
  resolved: ResolvedPrompt,
  carrier: ResolvedSystemIngressCarrier,
): void {
  const blocks = carrier.blocks.map((block) => Object.freeze({ ...block }));
  Object.defineProperty(resolved, systemIngressCarrier, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ ...carrier, blocks: Object.freeze(blocks) }),
  });
}

/** Read the explicit private provenance carried by one resolved prompt. */
export function systemIngressCarrierFor(
  resolved: ResolvedPrompt,
): ResolvedSystemIngressCarrier | undefined {
  return (
    resolved as ResolvedPrompt & {
      readonly [systemIngressCarrier]?: ResolvedSystemIngressCarrier;
    }
  )[systemIngressCarrier];
}

/** Keep provenance aligned when adaptations insert trusted system blocks. */
export function alignSystemIngressBlocks(
  adapted: readonly SystemBlock[],
  original: readonly SystemBlock[],
  provenance: readonly SystemIngressBlock[],
): readonly SystemIngressBlock[] {
  const byBlock = new Map(
    original.map((block, index) => [block, provenance[index]] as const),
  );
  return adapted.map((block) => {
    const retained = byBlock.get(block);
    return retained ?? { source: block.source, text: block.text };
  });
}
