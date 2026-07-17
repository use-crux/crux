package endpoints

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/review"
)

var Reviews = readmodel.Get(Registry, "GET /api/reviews",
	func(ctx context.Context, deps Deps) ([]review.Projection, error) {
		return deps.Reviews.ListReviews(ctx)
	})

var Review = readmodel.GetP[Deps, *readmodel.PathID, review.Detail](Registry, "GET /api/reviews/{reviewId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "reviewId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (review.Detail, error) {
		detail, found, err := deps.Reviews.ReviewDetail(ctx, params.ID)
		if err != nil || found {
			return detail, err
		}
		return detail, readmodel.ErrNotFound
	})
