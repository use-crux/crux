/**
 * Internal option marker for staged workspace mutations.
 *
 * @module
 */

const SUPPRESS_WORKSPACE_CHANGE_EVENTS: unique symbol = Symbol(
  "crux.workspace.suppressChangeEvents",
);

/** Non-enumerable marker carried by transaction staging options. */
export type WorkspaceChangeSuppressionOption = {
  readonly [SUPPRESS_WORKSPACE_CHANGE_EVENTS]?: true;
};

/** Return a shallow option copy that suppresses workspace watch event emission. */
export function suppressWorkspaceChangeEvents<T extends object>(
  options: T,
): T & WorkspaceChangeSuppressionOption {
  return Object.defineProperty({ ...options }, SUPPRESS_WORKSPACE_CHANGE_EVENTS, {
    value: true,
    enumerable: false,
  }) as T & WorkspaceChangeSuppressionOption;
}

/** Whether a workspace operation options object suppresses watch events. */
export function shouldSuppressWorkspaceChangeEvents(
  options: unknown,
): boolean {
  return (
    typeof options === "object" &&
    options !== null &&
    (options as WorkspaceChangeSuppressionOption)[
      SUPPRESS_WORKSPACE_CHANGE_EVENTS
    ] === true
  );
}
