package inspect

import (
	"context"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func projectRootFromStore(s *store.Store) string {
	if s == nil {
		return ""
	}
	if index := s.GetIndex(); index.Project != nil {
		return index.Project.Root
	}
	return ""
}

func buildInspectRunsFromObservability(ctx context.Context, obs *observability.Service, dir string, projectRoot string) ([]inspectRunRecord, error) {
	return buildInspectRunsFromObservabilityWithOptions(ctx, obs, dir, projectRoot, observability.RunListOptions{})
}

func buildInspectRunsFromObservabilityWithOptions(ctx context.Context, obs *observability.Service, dir string, projectRoot string, opts observability.RunListOptions) ([]inspectRunRecord, error) {
	summaries, err := obs.RunsWithOptions(ctx, opts)
	if err != nil {
		return nil, err
	}
	runIDs := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		runIDs = append(runIDs, summary.RunID)
	}
	signals, err := obs.RunSignalsForRuns(ctx, runIDs)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			signals = map[string]observability.RunSignals{}
		} else {
			return nil, err
		}
	}
	runs := make([]inspectRunRecord, 0, len(summaries))
	for _, summary := range summaries {
		run := inspectRunFromObservabilitySummary(summary)
		run = applyObservabilityRunSignals(run, signals[summary.RunID])
		runs = append(runs, run)
	}
	return runs, nil
}

// inspectCorrelationKey uses explicit operation identity. A distributed trace
// may contain several independent operations and cannot be a list-row key.
func inspectCorrelationKey(summary observability.RunSummary) string {
	if summary.OperationID != "" {
		return summary.OperationID
	}
	return summary.RunID
}
