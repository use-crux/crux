/** Framework-neutral explicit context storage supplied by a host adapter. @module */

/** A segment-local ambient context capability supplied explicitly by a host or adapter. */
export interface CruxContextStorage<T> {
  get(): T | undefined
  run<R>(value: T, fn: () => R): R
}
