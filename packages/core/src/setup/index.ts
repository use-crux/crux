/**
 * Public project setup contracts and pure orchestration helpers.
 *
 * @module
 */

export { defineSetupContributor } from './define-contributor.js'
export { createSetupPlanner } from './planner.js'
export type {
  SetupAction,
  SetupActionClassification,
  SetupContext,
  SetupContributor,
  SetupFinding,
  SetupMode,
  SetupPlanner,
  SetupReport,
  SetupResult,
  SetupSeverity,
} from './types.js'
