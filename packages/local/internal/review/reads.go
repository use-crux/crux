package review

import (
	"context"
	"database/sql"
	"errors"
)

// ListReviews returns Review projections newest-first without raw trace data.
func (s *Service) ListReviews(ctx context.Context) ([]Projection, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT review_id FROM reviews ORDER BY updated_at DESC, review_id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make([]Projection, 0, len(ids))
	for _, id := range ids {
		projection, _, err := s.Review(ctx, id)
		if err != nil {
			return nil, err
		}
		result = append(result, projection)
	}
	return result, nil
}

// ReviewDetail returns the immutable submissions/actions with the projection.
func (s *Service) ReviewDetail(ctx context.Context, reviewID string) (Detail, bool, error) {
	projection, submissions, err := s.Review(ctx, reviewID)
	if errors.Is(err, ErrNotFound) || errors.Is(err, sql.ErrNoRows) {
		return Detail{}, false, nil
	}
	if err != nil {
		return Detail{}, false, err
	}
	actions, err := s.Actions(ctx, reviewID)
	if err != nil {
		return Detail{}, false, err
	}
	return Detail{Projection: projection, Submissions: submissions, Actions: actions}, true, nil
}
