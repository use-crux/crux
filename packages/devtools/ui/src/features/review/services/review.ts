import { expectOk, fetchJson, postJson } from "@/shared/services/http";
import type {
  AddReviewCaseResult,
  ReviewDetail,
  ReviewProjection,
} from "../types";

type ReviewDetailWire = Omit<ReviewDetail, "submissions" | "actions"> & {
  readonly submissions: ReviewDetail["submissions"] | null;
  readonly actions: ReviewDetail["actions"] | null;
};

export const reviewService = {
  list: (signal?: AbortSignal) =>
    fetchJson<readonly ReviewProjection[]>("/api/reviews", signal),
  detail: async (reviewId: string, signal?: AbortSignal) => {
    const detail = await fetchJson<ReviewDetailWire>(
      `/api/reviews/${encodeURIComponent(reviewId)}`,
      signal,
    );
    return {
      ...detail,
      submissions: detail.submissions ?? [],
      actions: detail.actions ?? [],
    } satisfies ReviewDetail;
  },
  action: async (reviewId: string, body: Readonly<Record<string, unknown>>) => {
    const response = await postJson(
      `/api/reviews/${encodeURIComponent(reviewId)}/actions`,
      body,
    );
    await expectOk(response, "Review action");
    return (await response.json()) as ReviewProjection | AddReviewCaseResult;
  },
};
