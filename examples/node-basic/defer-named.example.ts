/**
 * Compiling example: named durable defer for serverless-style hosts.
 *
 * Requires Runtime configuration at the application boundary. This file is
 * typechecked with the workspace and indexed as deferred-work when present.
 */
import { defer } from "@use-crux/core";
import { withNamedOnlyDefer } from "@use-crux/core/defer/serverless";
import { durableTask } from "@use-crux/core/runtime";

const postProcess = durableTask("example-post-process", {
  run: async (input: { readonly jobId: string }) => input.jobId,
});

/** Named-only host handler (Lambda-style). Inline callbacks are unsupported. */
export const deferredNamedHandler = withNamedOnlyDefer(
  async (event: { readonly jobId: string }) => {
    const reference = await defer(postProcess, { jobId: event.jobId });
    return {
      accepted: true as const,
      workId: reference.workId,
      targetId: reference.targetId,
    };
  },
  { host: "lambda", durableFinalization: true },
);
