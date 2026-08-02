/** Boundary-only system contribution helpers. @internal */

import type { SystemBlock } from "../../resolver/types";

/** Append one sampled context block without changing the inherited baseline. */
export function appendStepSystemContext(
  system: string | undefined,
  systemBlocks: readonly SystemBlock[] | undefined,
  context: SystemBlock | undefined,
): {
  readonly system: string | undefined;
  readonly systemBlocks: readonly SystemBlock[] | undefined;
} {
  if (!context) return { system, systemBlocks };
  return {
    system: system ? `${system}\n\n${context.text}` : context.text,
    systemBlocks: systemBlocks
      ? Object.freeze([...systemBlocks, context])
      : undefined,
  };
}
