import type { JsonValue } from "../../../storage";

export interface AddReviewCaseInput {
  readonly projectRoot: string;
  readonly evalId: string;
  readonly id: string;
  readonly input: JsonValue;
  readonly call?: JsonValue;
  readonly name?: string;
  readonly tags?: readonly string[];
  readonly reviewId: string;
  readonly runId: string;
  readonly correctionProposal?: JsonValue;
  readonly saveCorrection?: boolean;
  readonly repositoryWritable?: boolean;
  readonly now?: () => Date;
}

export interface ReviewCaseArtifact {
  readonly path: string;
  readonly row: string;
  readonly diff: string;
  readonly unvalidatedExpected: boolean;
}

export type AddReviewCaseResult =
  | (ReviewCaseArtifact & {
      readonly status: "added" | "pending-sync";
      readonly caseId: string;
    })
  | (ReviewCaseArtifact & {
      readonly status: "linked";
      readonly caseId: string;
    })
  | (ReviewCaseArtifact & {
      readonly status: "conflict";
      readonly caseId: string;
      readonly existing: string;
    });
