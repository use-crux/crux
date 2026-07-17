export type ReviewStatus = "open" | "resolved" | "dismissed" | "added-to-eval";

export interface ReviewProjection {
  readonly reviewId: string;
  readonly runId: string;
  readonly status: ReviewStatus;
  readonly rating: "up" | "down";
  readonly comment?: string;
  readonly correction?: unknown;
  readonly contextStatus: "pending" | "linked";
  readonly context?: {
    readonly input?: unknown;
    readonly output?: unknown;
    readonly model?: string;
    readonly promptId?: string;
  };
  readonly targetEvalId?: string;
  readonly targetCaseId?: string;
  readonly updatedAt: string;
}

export interface ReviewDetail {
  readonly projection: ReviewProjection;
  readonly submissions: readonly {
    readonly feedbackId: string;
    readonly revision: number;
    readonly acceptedAt: string;
  }[];
  readonly actions: readonly {
    readonly actionId: string;
    readonly type: string;
    readonly createdAt: string;
  }[];
}

export interface AddReviewCaseResult {
  readonly status: "added" | "linked" | "conflict" | "pending-sync";
  readonly caseId: string;
  readonly path: string;
  readonly row: string;
  readonly unvalidatedExpected: boolean;
  readonly existing?: string;
}
