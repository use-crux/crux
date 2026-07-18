import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { reviewService } from "../services/review";

export function useReviews() {
  return useQuery({
    queryKey: qk.evals.reviews(),
    queryFn: ({ signal }) => reviewService.list(signal),
    refetchInterval: 2_000,
  });
}

export function useReview(reviewId?: string) {
  return useQuery({
    queryKey: qk.evals.review(reviewId),
    queryFn: ({ signal }) => reviewService.detail(reviewId ?? "", signal),
    enabled: Boolean(reviewId),
    refetchInterval: 2_000,
  });
}

export function useReviewAction(reviewId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) =>
      reviewService.action(reviewId ?? "", body),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.evals.reviews() });
      void client.invalidateQueries({ queryKey: qk.evals.review(reviewId) });
      void client.invalidateQueries({ queryKey: qk.evals.catalog() });
    },
  });
}
