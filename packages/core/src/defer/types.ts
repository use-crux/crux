/** A value that may complete synchronously or asynchronously. */
export type Awaitable<T> = T | PromiseLike<T>;

/** Lazy, invocation-scoped callback accepted by `defer()`. */
export type DeferredCallback = () => Awaitable<void>;
