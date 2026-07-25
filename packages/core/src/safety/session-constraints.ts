import type { Message } from "../generation/messages";
import { observeConstraintCheck, runConstraints } from "./constraint/runner";
import type {
  Constraint,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintContext,
} from "./constraint/types";
import type { ConstraintOccurrenceSettlement } from "./constraint/settlement";
import type {
  ConstraintFeedbackFormatter,
  SafetyContext,
  SafetyOutput,
  SafetyProtocolEvent,
} from "./session-contract";

export interface SessionConstraintRunner {
  readonly audit: ConstraintAudit | undefined;
  apply(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
    settled?: readonly ConstraintOccurrenceSettlement[],
  ): Promise<SafetyOutput>;
  report(output: SafetyOutput): Promise<void>;
  replaceAudit(audit: ConstraintAudit | undefined): void;
}

/** Own constraint execution and audit mutation for one Safety session. */
export function createSessionConstraintRunner(
  options: Readonly<{
    constraints: readonly Constraint[];
    reportConstraints: readonly Constraint[];
    formatter: ConstraintFeedbackFormatter;
    formatterContext: () => SafetyContext;
    constraintContext: () => ConstraintContext;
    constraintMaxRetries?: number;
    transcript: SafetyProtocolEvent[];
  }>,
): SessionConstraintRunner {
  let audit: ConstraintAudit | undefined;

  return {
    get audit() {
      return audit;
    },

    async apply(output, regenerate, guardCandidate, settled) {
      let rounds = 0;
      const result = await runConstraints(
        options.constraints,
        { text: output.text, parsed: output.parsed },
        options.constraintContext(),
        async (_feedback, failures) => {
          const formatted = options.formatter.format(
            failures,
            options.formatterContext(),
          );
          const corrective: readonly Message[] =
            typeof formatted === "string"
              ? [{ role: "user", content: formatted }]
              : formatted;
          const next = await regenerate(corrective);
          const guarded = await guardCandidate({
            text: next.text,
            parsed: next.parsed,
          });
          return { text: guarded.text, parsed: guarded.parsed };
        },
        {
          constraintMaxRetries: options.constraintMaxRetries,
          ...(settled && settled.length > 0 ? { settled } : {}),
          onCheck: () => {},
          onRetry: (_failed, attempt) => {
            rounds = attempt;
            options.transcript.push({
              t: "constraint.round",
              attempt,
              verdict: "retry",
            });
          },
          onViolation: () => {},
        },
      );
      audit = result.audit;
      options.transcript.push({
        t: "constraint.round",
        attempt: rounds,
        verdict: "accept",
      });
      return { text: result.output.text, parsed: result.output.parsed };
    },

    async report(output) {
      if (options.reportConstraints.length === 0) return;
      const checks = await Promise.all(
        options.reportConstraints.map((constraint) =>
          observeConstraintCheck(
            constraint,
            { text: output.text, parsed: output.parsed },
            options.constraintContext(),
          ),
        ),
      );
      const entries: ConstraintAuditEntry[] = checks.map((check) => ({
        constraint: check.constraint.id,
        ...(check.constraint.category !== undefined
          ? { category: check.constraint.category }
          : {}),
        severity: check.constraint.severity,
        pass: check.result.pass,
        feedback: check.result.pass ? undefined : check.result.feedback,
        attempts: 1,
        durationMs: check.durationMs,
        metadata: check.result.metadata,
      }));
      const hasSuggestFailures = entries.some(
        (entry) => !entry.pass && entry.severity === "suggest",
      );
      const hasAssertFailures = entries.some(
        (entry) => !entry.pass && entry.severity === "assert",
      );
      audit = {
        entries: [...(audit?.entries ?? []), ...entries],
        allPassed:
          (audit?.allPassed ?? true) && entries.every((entry) => entry.pass),
        suggestFallback:
          audit?.suggestFallback === true ||
          (hasSuggestFailures && !hasAssertFailures),
      };
    },

    replaceAudit(nextAudit) {
      audit = nextAudit;
    },
  };
}
