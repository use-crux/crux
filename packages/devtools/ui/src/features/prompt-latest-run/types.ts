/** Strict successful or owner-classification result from the Local resolver. */
export type PromptLatestRunResult =
  | {
      readonly status: "found";
      readonly definitionId: string;
      readonly observabilityRevision: number;
      readonly operationId: string;
      readonly path: string;
    }
  | {
      readonly status: "empty";
      readonly definitionId: string;
      readonly observabilityRevision: number;
      readonly path: string;
      readonly exactPreview: {
        readonly status: "available" | "unavailable";
      };
    }
  | {
      readonly status: "unavailable";
      readonly reason: "owner-not-found" | "owner-not-prompt";
      readonly message: string;
    };

/** Strict error envelope returned before owner resolution can complete. */
export type PromptLatestRunError = {
  readonly status: "error";
  readonly code:
    | "invalid_request"
    | "forbidden"
    | "method_not_allowed"
    | "temporarily_unavailable";
  readonly message: string;
};

/** Complete bounded response union consumed by the Devtools latest-Run flow. */
export type PromptLatestRunResponse =
  | PromptLatestRunResult
  | PromptLatestRunError;
