/** Durable Session store statistics ledger helpers. @internal @module */

export {
  initialSessionStatistics,
  recordSessionStatistics,
  sessionStatistics,
} from "../engine/session-statistics";
export type {
  ScopeStats,
  StatisticsFact,
  StatisticsLedgerExport,
} from "../../statistics";
