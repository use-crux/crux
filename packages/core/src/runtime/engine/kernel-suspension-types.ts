/** Runtime suspension registration contracts. */

import type { JsonValue } from "../../storage";

/** One suspend/wait registration produced by Flow replay. */
export interface RuntimeSuspendRegistration {
  /** User-authored suspend/wait label. */
  readonly label: string;
  /** Source-order replay key for disambiguating repeated labels. */
  readonly deliveryKey?: string;
  /** Event name that can resume this suspend point. */
  readonly eventName: string;
  /** Static Signal identity when this is a durable Signal wait. */
  readonly signalId?: string;
  /** Canonical match data when the Signal source is match-filtered. */
  readonly signalMatch?: JsonValue;
  /** Retain one durable binding while deployed predicate code filters candidates. */
  readonly signalPredicate?: true;
  /** Top-level payload equality match for this waiter. */
  readonly match: Readonly<Record<string, JsonValue>>;
  /** Optional timeout deadline that resumes work with `flow.timeout`. */
  readonly timeoutAt?: Date;
}
