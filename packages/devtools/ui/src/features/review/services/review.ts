import { expectOk, fetchJson, postJson } from "@/shared/services/http";
import type {
  AddReviewCaseResult,
  ReviewDetail,
  ReviewProjection,
} from "../types";

export const reviewService = {
  list: (signal?: AbortSignal) =>
    fetchJson<readonly ReviewProjection[]>("/api/reviews", signal),
  detail: (reviewId: string, signal?: AbortSignal) =>
    fetchJson<ReviewDetail>(
      `/api/reviews/${encodeURIComponent(reviewId)}`,
      signal,
    ),
  action: async (reviewId: string, body: Readonly<Record<string, unknown>>) => {
    const response = await postJson(
      `/api/reviews/${encodeURIComponent(reviewId)}/actions`,
      body,
    );
    await expectOk(response, "Review action");
    return (await response.json()) as ReviewProjection | AddReviewCaseResult;
  },
};
