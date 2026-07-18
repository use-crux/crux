/** Conservative pre-spend Eval pricing overrides. */
export interface CruxExperimentalEvalPrice {
  /** Maximum USD that one provider call may spend. */
  readonly maxUsdPerCall: number;
}

/** Experimental Eval policy configured once in `crux.config.*`. */
export interface CruxExperimentalEvalConfig {
  /** Per-model ceilings, with optional `default` fallback. */
  readonly pricing?: Readonly<Record<string, CruxExperimentalEvalPrice>>;
}
