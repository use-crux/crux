/** A value that may complete synchronously or asynchronously. */
export type Awaitable<T> = T | PromiseLike<T>;

/** Lazy, invocation-scoped callback accepted by `defer()`. */
export type DeferredCallback = () => Awaitable<void>;

/** Durable acceptance reference returned by named `defer()`. */
export interface DeferredWorkRef<TWorkId extends string = string> {
  /** Discriminant for future deferred reference kinds. */
  readonly kind: "deferred.work";
  /** Stable Runtime work identity accepted by the durable store. */
  readonly workId: TWorkId;
  /** Name-based Runtime target identity. */
  readonly targetId: string;
}
