import { ReviewView } from "@/features/review/components/ReviewView";
export function ReviewPage({ reviewId }: { reviewId?: string }) {
  return <ReviewView reviewId={reviewId} />;
}
