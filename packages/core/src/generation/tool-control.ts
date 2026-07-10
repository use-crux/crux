/**
 * Provider-neutral tool-loop controls.
 *
 * These helpers describe portable tool-choice and loop-stop intent before an
 * adapter maps it to provider-native request fields. Provider-specific controls
 * still belong in each adapter's typed `extra` option.
 *
 * @module
 */

/**
 * Portable tool choice policy.
 *
 * Adapters map this shape to their native request vocabulary at the execution
 * boundary. Use adapter `extra` fields for provider-specific variants that are
 * not represented here.
 */
export type ToolChoice = "auto" | "none" | "required" | { tool: string };

/** Stop after a fixed number of non-refunded model steps. */
export interface MaxStepsStopCondition {
  kind: "maxSteps";
  steps: number;
}

/** Stop as soon as a completed model step requests the named tool. */
export interface HasToolCallStopCondition {
  kind: "hasToolCall";
  tool: string;
}

/** Portable loop stop condition. Multiple conditions are OR-composed. */
export type StopCondition = MaxStepsStopCondition | HasToolCallStopCondition;

/** Minimal settings shape needed to derive neutral stop conditions. */
export interface ToolControlSettings {
  readonly stopWhen?: StopCondition | readonly StopCondition[];
  readonly maxSteps?: number;
}

/** Completed, non-refunded loop round used to evaluate stop conditions. */
export interface CompletedToolRound {
  readonly steps: number;
  readonly toolCalls: ReadonlyArray<{ readonly name: string }>;
}

/**
 * Stop after `steps` completed model steps.
 *
 * Skill-load bookkeeping rounds that are refunded by Crux do not count toward
 * this budget.
 */
export function maxSteps(steps: number): StopCondition {
  return { kind: "maxSteps", steps };
}

/** Stop after a completed model step requests `tool`. */
export function hasToolCall(tool: string): StopCondition {
  return { kind: "hasToolCall", tool };
}

/**
 * Normalize authored loop controls into OR-composed stop conditions.
 *
 * The numeric step budget is represented as a condition so core-step and
 * SDK-loop adapters can share one vocabulary while still retaining the public
 * `maxSteps` shorthand.
 *
 * @internal
 */
export function normalizeStopConditions(
  settings: ToolControlSettings,
  stepBudget: number,
): readonly StopCondition[] {
  const authored =
    settings.stopWhen === undefined
      ? []
      : Array.isArray(settings.stopWhen)
        ? settings.stopWhen
        : [settings.stopWhen];
  return [...authored, maxSteps(stepBudget)];
}

/**
 * Return the first stop condition triggered by a completed loop round.
 *
 * @internal
 */
export function findTriggeredStopCondition(
  conditions: readonly StopCondition[],
  round: CompletedToolRound,
): StopCondition | undefined {
  return conditions.find((condition) => {
    switch (condition.kind) {
      case "maxSteps":
        return round.steps >= condition.steps;
      case "hasToolCall":
        return round.toolCalls.some(
          (toolCall) => toolCall.name === condition.tool,
        );
    }
  });
}
