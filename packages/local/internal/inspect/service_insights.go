package inspect

import (
	"context"
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Service) Insights(ctx context.Context) ([]inspectInsightRecord, error) {
	runs := []inspectRunRecord{}
	revision := int64(0)
	if s.obs != nil {
		var err error
		runs, revision, err = s.projectedRunsAtRevision(ctx)
		if err != nil {
			return nil, err
		}
	}
	state, err := s.fs.ReadInsightState()
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	indexCapture := s.store.CaptureProjectIndex()
	index := indexCapture.Index
	now := time.Now().UTC()
	timeBucket := now.Unix() / 60
	s.insightsMu.Lock()
	defer s.insightsMu.Unlock()
	if s.insightsReady && s.insightsRevision == revision && s.insightsState == string(stateJSON) && s.insightsIndexGeneration == indexCapture.Generation && s.insightsTimeBucket == timeBucket {
		return cloneInspectInsightRecords(s.insightsCache), nil
	}
	insights := deriveInsights(inspectInsightInputs{
		Statuses: state.Statuses,
		Silences: state.Silences,
		Runs:     runs,
		Now:      now,
	})
	enriched, err := enrichInspectInsightsWithIndex(insights, index, s.dir, runs)
	if err != nil {
		return nil, err
	}
	s.publishDerivedInsightChanges(enriched)
	s.insightsCache = append(s.insightsCache[:0], enriched...)
	s.insightsRevision = revision
	s.insightsState = string(stateJSON)
	s.insightsIndexGeneration = indexCapture.Generation
	s.insightsTimeBucket = timeBucket
	s.insightsReady = true
	return cloneInspectInsightRecords(s.insightsCache), nil
}

func (s *Service) InsightsAPI(ctx context.Context) ([]api.InspectInsightRecord, error) {
	return toAPI[[]api.InspectInsightRecord](s.Insights(ctx))
}
