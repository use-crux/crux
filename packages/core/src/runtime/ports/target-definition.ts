/** Immutable generated identity for one executable Runtime target. */

import type { RuntimeTargetId } from "./ids";

/** Definition metadata pinned when application Work is accepted. */
export interface RuntimeTargetDefinitionRef {
  /** Stable executable target identity. */
  readonly targetId: RuntimeTargetId;
  /** Exact Project Index definition identity. */
  readonly definitionId: string;
  /** Exact generated definition fingerprint. */
  readonly fingerprint: string;
  /** Runtime program manifest that supplied this definition. */
  readonly manifestHash: string;
}
