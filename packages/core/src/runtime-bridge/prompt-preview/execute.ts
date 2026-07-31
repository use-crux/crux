/**
 * Explicit observational request preview for one canonical Prompt.
 *
 * The command captures one catalogue publication and races its single
 * inspection against deadline and retirement. Application callbacks are not
 * abortable; any late outcome is discarded after response ownership retires.
 *
 * @module
 */

import { PromptInputValidationError } from "../../resolver/input-validation-error";
import { preview } from "../../request/preview/preview";
import {
  activePromptCatalogue,
  subscribePromptCatalogue,
} from "../../runtime/prompt-catalogue";
import { promptPreviewCapability } from "./catalogue";
import { utf8Bytes } from "./limits";
import {
  PromptPreviewRequestSchema,
  ScalarValidStringSchema,
  type PromptPreviewRequest,
} from "./protocol";
import {
  PromptPreviewValidationResultSchema,
  type PromptPreviewError,
  type PromptPreviewResult,
} from "./result-protocol";
import {
  projectRequestPreview,
  PromptPreviewResultLimitError,
} from "./projection";
import {
  PromptPreviewRequestValidationError,
  validatePromptPreviewRequest,
} from "./validate";

/** Safe command failure consumed by bridge-specific error envelopes. */
export class PromptPreviewCommandError extends Error {
  override readonly name = "PromptPreviewCommandError";

  constructor(
    readonly previewError: PromptPreviewError,
    options?: ErrorOptions,
  ) {
    super(previewError.message, options);
  }
}

/**
 * Inspect one canonical target exactly once after an explicit command.
 *
 * @param request - Strict request already decoded from the bridge wire.
 * @returns Ready or expected validation result for the captured target.
 * @throws {@link PromptPreviewCommandError} for retirement, timeout, and
 * unexpected application failures.
 */
export async function executePromptPreview(
  request: PromptPreviewRequest,
  options: PromptPreviewExecutionOptions = {},
): Promise<PromptPreviewResult> {
  try {
    validatePromptPreviewRequest(request);
  } catch (error) {
    if (error instanceof PromptPreviewRequestValidationError) {
      throw previewError(
        error.kind === "limit" ? "input_limit_exceeded" : "invalid_request",
        error.kind === "limit"
          ? "Exact-preview input exceeds a limit."
          : "Exact-preview request is invalid.",
      );
    }
    throw error;
  }
  const decodedRequest = PromptPreviewRequestSchema.safeParse(request);
  if (!decodedRequest.success) {
    throw previewError("invalid_request", "Exact-preview request is invalid.");
  }
  request = decodedRequest.data;
  const catalogue = activePromptCatalogue();
  if (catalogue.revision !== request.catalogueRevision) {
    throw previewError(
      "catalogue_changed",
      "The runtime prompt catalogue changed.",
      {
        expectedCatalogueRevision: request.catalogueRevision,
        actualCatalogueRevision: catalogue.revision || undefined,
      },
    );
  }
  const capability = promptPreviewCapability(
    catalogue.revision,
    catalogue.entries,
  );
  const advertised = capability?.targets.some(
    (target) => target.definitionId === request.targetId,
  );
  const entry = advertised
    ? catalogue.entries.find(
        (candidate) => candidate.target.definitionId === request.targetId,
      )
    : undefined;
  if (!entry) {
    throw previewError("target_unavailable", "Prompt target is unavailable.", {
      targetId: request.targetId,
    });
  }
  if (
    entry.target.input.mode === "none" &&
    Object.keys(request.payload.input).length > 0
  ) {
    throw previewError("invalid_request", "Exact-preview request is invalid.");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let retire: ((error: PromptPreviewCommandError) => void) | undefined;
  const retired = new Promise<never>((_resolve, reject) => {
    retire = reject;
  });
  const unsubscribe = subscribePromptCatalogue((replacement) => {
    if (!settled && replacement.revision !== request.catalogueRevision) {
      retire?.(
        previewError(
          "target_retired",
          "Prompt target retired during inspection.",
          {
            targetId: request.targetId,
            expectedCatalogueRevision: request.catalogueRevision,
            actualCatalogueRevision: replacement.revision,
          },
        ),
      );
    }
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          previewError("inspection_timeout", "Prompt inspection timed out.", {
            targetId: request.targetId,
          }),
        ),
      request.deadlineMs,
    );
  });
  const cancellation = abortRace(options.signal);

  try {
    const inspected = Promise.resolve()
      .then(() =>
        preview(entry.prompt, {
          input: request.payload.input,
          provider: request.payload.options?.provider,
          model: request.payload.options?.modelId ?? "unknown",
        }),
      )
      .then(
        (inspection) => {
          try {
            return projectRequestPreview(
              request.targetId,
              request.catalogueRevision,
              inspection,
            );
          } catch (error) {
            if (error instanceof PromptPreviewResultLimitError) {
              throw previewError(
                "result_limit_exceeded",
                "Exact-preview result exceeds a limit.",
                { targetId: request.targetId },
              );
            }
            throw previewError(
              "inspection_failed",
              "Prompt inspection failed.",
              { targetId: request.targetId },
            );
          }
        },
        (error: unknown) =>
          inspectionFailureResult(
            error,
            request.targetId,
            request.catalogueRevision,
          ),
      );
    return await Promise.race([
      inspected,
      retired,
      deadline,
      cancellation.promise,
    ]);
  } finally {
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    cancellation.dispose();
    unsubscribe();
  }
}

function inspectionFailureResult(
  error: unknown,
  targetId: string,
  catalogueRevision: number,
): PromptPreviewResult {
  if (error instanceof PromptInputValidationError) {
    const issues = error.issues.slice(0, 128);
    const parsed = PromptPreviewValidationResultSchema.safeParse({
      status: "validation-error",
      targetId,
      catalogueRevision,
      issues,
      omittedIssueCount: error.issues.length - issues.length,
    });
    if (parsed.success) return parsed.data;
    throw previewError("inspection_failed", "Prompt inspection failed.", {
      targetId,
    });
  }
  if (error instanceof PromptPreviewCommandError) throw error;
  throw previewError("inspection_failed", inspectionFailureMessage(error), {
    targetId,
  });
}

/** Transport-owned execution controls that never enter application callbacks. */
export interface PromptPreviewExecutionOptions {
  readonly signal?: AbortSignal;
}

function abortRace(signal: AbortSignal | undefined): {
  readonly promise: Promise<never>;
  dispose(): void;
} {
  if (!signal) {
    return {
      promise: new Promise<never>(() => undefined),
      dispose() {},
    };
  }
  const listener = () =>
    rejectCancellation?.(
      previewError("internal_error", "Prompt preview was cancelled."),
    );
  let rejectCancellation:
    | ((reason: PromptPreviewCommandError) => void)
    | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
    if (signal.aborted) {
      reject(previewError("internal_error", "Prompt preview was cancelled."));
      return;
    }
    signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    dispose() {
      rejectCancellation = undefined;
      signal.removeEventListener("abort", listener);
    },
  };
}

function previewError(
  code: PromptPreviewError["code"],
  message: string,
  details?: PromptPreviewError["details"],
): PromptPreviewCommandError {
  return new PromptPreviewCommandError({
    code,
    message,
    ...(details ? { details } : {}),
  });
}

function inspectionFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Prompt inspection failed.";
  if (!ScalarValidStringSchema.safeParse(error.message).success) {
    return "Prompt inspection failed.";
  }
  const message = scalarSafePrefix(error.message, 1024);
  return message || "Prompt inspection failed.";
}

function scalarSafePrefix(value: string, maxBytes: number): string {
  let output = "";
  for (const scalar of value) {
    if (utf8Bytes(output) + utf8Bytes(scalar) > maxBytes) break;
    output += scalar;
  }
  return output;
}
