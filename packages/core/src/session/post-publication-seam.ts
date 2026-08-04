/** Internal Runtime-store seam immediately after Session Thread publication. */

/** Optional adapter hook used only for deterministic post-publication faults. @internal */
export const sessionPostPublicationSeam: unique symbol = Symbol(
  "crux.session.post-publication-seam",
);

/** Invocation evidence supplied to the internal post-publication seam. */
export interface SessionPostPublicationInput {
  readonly sessionId: string;
  readonly workId: string;
}

/** Internal post-publication callback implemented by test stores only. */
export type SessionPostPublicationSeam = (
  input: SessionPostPublicationInput,
) => void | Promise<void>;
