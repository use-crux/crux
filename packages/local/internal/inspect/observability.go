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

// inspectCorrelationKey is the one deterministic identifier used to join a
// canonical observability run to Inspect's trace-keyed metadata: the run's
// TraceID, or its RunID only when the run genuinely has no distinct trace
// identity. It must not be tried as a second, unconditional lookup after a
// present TraceID simply has no match — that previously let an unrelated
// run's RunID collide with this run's TraceID key space.
func inspectCorrelationKey(summary observability.RunSummary) string {
	if summary.TraceID != "" {
		return summary.TraceID
	}
	return summary.RunID
}
