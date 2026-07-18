/**
 * Small formatting helpers specific to the `Explain` tab.
 *
 * Token/duration/cost formatting is shared with the rest of run-detail
 * (`fmtTokens`/`fmtDuration`/`fmtCost` in `span-detail-inspection`); only the
 * freshness *age* readout (an `ageMs`/`maxAgeMs` window) is local here.
 */

/** Format an age in milliseconds as a compact `m`/`h` string (`'30m'`, `'1.5h'`). */
export function fmtAge(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${hours.toFixed(1).replace(/\.0$/, "")}h`;
  return `${Math.round(ms / 60_000)}m`;
}
