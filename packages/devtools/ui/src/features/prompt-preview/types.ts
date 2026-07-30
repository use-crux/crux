export type PromptPreviewEnvironment =
  | "node"
  | "convex"
  | "serverless"
  | "browser"
  | "unknown";

export interface PromptPreviewChoice {
  readonly peerId: string;
  readonly runtimeName: string;
  readonly environment: PromptPreviewEnvironment;
  readonly catalogueRevision: number;
  readonly target: {
    readonly name: string;
    readonly description?: string;
    readonly input:
      | { readonly mode: "none" }
      | { readonly mode: "raw" }
      | {
          readonly mode: "schema";
          readonly schema: Readonly<Record<string, unknown>>;
        };
  };
}

export type PromptPreviewDiscovery =
  | {
      readonly status: "ready";
      readonly projectionRevision: number;
      readonly owner: {
        readonly definitionId: string;
        readonly kind: "prompt";
        readonly name: string;
        readonly description?: string;
      };
      readonly choices: readonly PromptPreviewChoice[];
    }
  | {
      readonly status: "unavailable";
      readonly projectionRevision: number;
      readonly reason:
        | "owner-not-found"
        | "owner-not-prompt"
        | "no-peer"
        | "capability-unavailable"
        | "target-unavailable"
        | "projection-limit-exceeded";
      readonly message: string;
    };

export type PromptPreviewBrowserErrorCode =
  | "invalid_request"
  | "input_limit_exceeded"
  | "no_peer"
  | "environment_unavailable"
  | "capability_unavailable"
  | "target_unavailable"
  | "catalogue_changed"
  | "ambiguous_peer"
  | "peer_disconnected"
  | "target_disappeared"
  | "deadline_exceeded"
  | "cancelled"
  | "invalid_response"
  | "command_failed"
  | "endpoint_not_allowed"
  | "response_limit_exceeded"
  | "internal_error";

export interface PromptPreviewSegment {
  readonly kind: "static" | "dynamic" | "unknown";
  readonly startUtf16: number;
  readonly endUtf16: number;
  readonly source?: string;
  readonly observedAt?: number;
  readonly sourceVersion?: string;
}

export interface PromptPreviewText {
  readonly text: string;
  readonly tokens: number;
  readonly segments: readonly PromptPreviewSegment[];
  readonly staticTokens?: number;
  readonly dynamicTokens?: number;
}

export interface PromptPreviewInspection {
  readonly system: {
    readonly text: string;
    readonly tokens: number;
    readonly coverage: "complete" | "partial";
    readonly parts: readonly (PromptPreviewText & {
      readonly source: string;
      readonly skipped: boolean;
    })[];
  };
  readonly prompt?: PromptPreviewText;
  readonly totalTokens: number;
  readonly tokenBudget?: number;
  readonly droppedContexts: readonly (PromptPreviewText & {
    readonly source: string;
    readonly priority: number;
  })[];
  readonly excludedContexts: readonly {
    readonly source: string;
    readonly reason: string;
  }[];
  readonly tools?: readonly string[];
}

export interface PromptPreviewValidationIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type PromptPreviewBrowserResponse =
  | {
      readonly status: "ready";
      readonly peer: {
        readonly peerId: string;
        readonly runtimeName: string;
        readonly environment: PromptPreviewEnvironment;
      };
      readonly catalogueRevision: number;
      readonly inspection: PromptPreviewInspection;
    }
  | {
      readonly status: "validation-error";
      readonly catalogueRevision: number;
      readonly issues: readonly PromptPreviewValidationIssue[];
      readonly omittedIssueCount: number;
    }
  | {
      readonly status: "error";
      readonly code: PromptPreviewBrowserErrorCode;
      readonly message: string;
      readonly choices?: readonly {
        readonly peerId: string;
        readonly runtimeName: string;
        readonly environment: PromptPreviewEnvironment;
      }[];
    };

export interface PromptPreviewWorkflowState {
  readonly phase:
    | "idle"
    | "unavailable"
    | "input"
    | "running"
    | "ready"
    | "validation-error"
    | "error";
  readonly rawText: string;
  readonly canPreview: boolean;
  readonly message?: string;
  readonly discovery?: PromptPreviewDiscovery;
  readonly selected?: PromptPreviewChoice;
  readonly result?: PromptPreviewBrowserResponse;
}
