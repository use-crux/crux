package quality

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Service) Insights(ctx context.Context) ([]qualityInsightRecord, error) {
	runs := []qualityRunRecord{}
	if s.obs != nil {
		var err error
		runs, err = buildQualityRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
		if err != nil {
			return nil, err
		}
	}
	fs := s.fs
	specExperiments, _, err := fs.ReadExperimentRecords()
	if err != nil {
		return nil, err
	}
	snapshot, err := fs.Snapshot()
	if err != nil {
		return nil, err
	}
	insights := deriveInsights(qualityInsightInputs{
		Quality:         snapshot,
		SpecExperiments: specExperiments,
		Runs:            runs,
		Now:             time.Now().UTC(),
	})
	enriched, err := enrichQualityInsightsWithIndex(insights, s.store.GetIndex(), s.dir, runs)
	if err != nil {
		return nil, err
	}
	s.publishDerivedInsightChanges(enriched)
	s.publishCassetteDriftChanges(snapshot.Cassettes)
	return enriched, nil
}

func (s *Service) InsightsAPI(ctx context.Context) ([]api.QualityInsightRecord, error) {
	return toAPI[[]api.QualityInsightRecord](s.Insights(ctx))
}
