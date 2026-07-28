import type { MediaPartSubject } from "../boundary";
import type { GuardrailAudit, GuardrailContext } from "../guardrail/types";
import { visitMedia, type MediaVisitResult } from "../media/visit";
import type { GuardrailBinding } from "../registry";

interface GuardOutputMediaOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly subjects: readonly MediaPartSubject[];
  readonly minimumRetained: number;
  readonly context:
    | GuardrailContext
    | ((subject: MediaPartSubject) => GuardrailContext);
  readonly appendAudit: (audit: GuardrailAudit) => void;
}

/** @internal Retained subjects and actions from one output-media pass. */
export type MediaOutputResult = MediaVisitResult;

/** Guard canonical output media in stable subject and binding order. */
export function guardOutputMedia(
  options: GuardOutputMediaOptions,
): Promise<MediaOutputResult> {
  const groupId = "output";
  return visitMedia({
    phase: "output",
    bindings: options.bindings,
    items: options.subjects.map((subject) => ({ subject, groupId })),
    groups: [
      {
        id: groupId,
        size: options.subjects.length,
        minimumRetained: options.minimumRetained,
      },
    ],
    context: ({ subject }) =>
      typeof options.context === "function"
        ? options.context(subject)
        : options.context,
    appendAudit: options.appendAudit,
  });
}
