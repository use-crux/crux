package inspect

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Service) Insights(ctx context.Context) ([]inspectInsightRecord, error) {
	runs := []inspectRunRecord{}
	if s.obs != nil {
		var err error
		runs, err = buildInspectRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
		if err != nil {
			return nil, err
		}
	}
	state, err := s.fs.ReadInsightState()
	if err != nil {
		return nil, err
	}
	insights := deriveInsights(inspectInsightInputs{
		Statuses: state.Statuses,
		Silences: state.Silences,
		Runs:     runs,
		Now:      time.Now().UTC(),
	})
	enriched, err := enrichInspectInsightsWithIndex(insights, s.store.GetIndex(), s.dir, runs)
	if err != nil {
		return nil, err
	}
	s.publishDerivedInsightChanges(enriched)
	return enriched, nil
}

func (s *Service) InsightsAPI(ctx context.Context) ([]api.InspectInsightRecord, error) {
	return toAPI[[]api.InspectInsightRecord](s.Insights(ctx))
}
