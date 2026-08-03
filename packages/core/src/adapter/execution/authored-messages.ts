/** Canonical message projection shared by managed Prompt ingress paths. */

import type { Message } from "../../generation/messages";
import type { ResolvedPrompt } from "../../resolver/types";

/** Project one independently resolved Prompt into its canonical authored messages. */
export function authoredMessages(resolved: ResolvedPrompt): readonly Message[] {
  if (resolved.prompt) return [{ role: "user", content: resolved.prompt }];
  return (resolved.messages ?? []) as readonly Message[];
}
