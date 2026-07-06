/**
 * Types for the per-turn explanation read model shown in Run Detail.
 *
 * `TurnDecisionReport` is a deterministic projection over recorded Crux
 * evidence. It summarizes what shaped one generation turn and links back to
 * the deeper Context, Routing, Cache, Guardrail, Security, Constraint, and
 * Compaction views without duplicating their payloads.
 *
 * @module
 */

export * from "./turn-decision-report/evidence";
export * from "./turn-decision-report/items";
export * from "./turn-decision-report/report";
export * from "./turn-decision-report/safety";
export * from "./turn-decision-report/shared";
export * from "./turn-decision-report/source-coverage";
export * from "./turn-decision-report/targets";
