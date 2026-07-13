import { createAsyncScopeFacet } from "../../async-scope";

const deferReplayGuard = createAsyncScopeFacet<true>("core.defer-replay");

/** Return whether public deferred work is inside replayable execution. @internal */
export function deferReplayActive(): boolean {
  return deferReplayGuard.current() === true;
}

/** Mark one callback and its asynchronous children as replayable. @internal */
export function runWithDeferReplayGuard<R>(callback: () => R): R {
  return deferReplayGuard.run(true, callback);
}
