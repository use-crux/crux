/**
 * Presentation read-model — versioned independently of the wire contract; NOT covered by schema-version guarantees.
 *
 * These exports describe local/devtools projections built from canonical graph
 * records. Keep wire records, IDs, and canonical taxonomy in `contract.ts`;
 * presentation shapes can evolve with the read model and UI.
 *
 * @module
 */

export * from "./presentation/base";
export * from "./presentation/run-detail-request";
export * from "./presentation/manifest-resolution";
export * from "./presentation/project-health";
export * from "./presentation/run-detail";
