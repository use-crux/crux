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
	return buildInspectRunsFromObservabilityWithOptions(ctx, obs, dir, projectRoot, observability.RunListOptions{Limit: -1})
}

func buildInspectRunsFromObservabilityWithOptions(ctx context.Context, obs *observability.Service, dir string, projectRoot string, opts observability.RunListOptions) ([]inspectRunRecord, error) {
	// Inspect needs aggregate identity, cost, and signals, but not the segment,
	// delivery, topology, and raw span/event enrichment owned by canonical
	// Runs pages. Stored operation rollups are the exact cheap input here.
	opts.IncludeExpensiveRollups = false
	var summaries []observability.RunSummary
	var err error
	if opts.Limit < 0 && opts.Offset == 0 && opts.SessionID == "" && len(opts.Status) == 0 && opts.Since == "" && opts.Until == "" && opts.DefinitionID == "" && opts.Cursor == "" {
		summaries, err = obs.RunSummarySnapshot(ctx)
	} else {
		summaries, err = obs.RunsWithOptions(ctx, opts)
	}
	if err != nil {
		return nil, err
	}
	operationIDs := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		operationIDs = append(operationIDs, summary.OperationID)
	}
	signals, err := obs.RunSignalsForOperations(ctx, operationIDs)
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
		run = applyObservabilityRunSignals(run, signals[summary.OperationID])
		runs = append(runs, run)
	}
	return runs, nil
}

func (s *Service) projectedRuns(ctx context.Context) ([]inspectRunRecord, error) {
	runs, _, err := s.projectedRunsAtRevision(ctx)
	return runs, err
}

func (s *Service) projectedRunsAtRevision(ctx context.Context) ([]inspectRunRecord, int64, error) {
	s.runsMu.Lock()
	defer s.runsMu.Unlock()
	if s.obs == nil {
		return []inspectRunRecord{}, 0, nil
	}
	revision, err := s.obs.CurrentRevision(ctx)
	if err != nil {
		return nil, 0, err
	}
	if s.runsReady && s.runsRevision == revision {
		return cloneInspectRunRecords(s.runsCache), revision, nil
	}
	runs, err := buildInspectRunsFromObservability(ctx, s.obs, s.dir, projectRootFromStore(s.store))
	if err != nil {
		return nil, 0, err
	}
	s.runsCache = append(s.runsCache[:0], runs...)
	s.runsRevision = revision
	s.runsReady = true
	return cloneInspectRunRecords(s.runsCache), revision, nil
}

// inspectCorrelationKey uses explicit operation identity. A distributed trace
// may contain several independent operations and cannot be a list-row key.
func inspectCorrelationKey(summary observability.RunSummary) string {
	if summary.OperationID != "" {
		return summary.OperationID
	}
	return summary.RunID
}
