package observability

import (
	"context"
	"fmt"
	"strings"
)

type runSegmentSummaryState struct {
	segments       map[string]struct{}
	previousCounts map[string]int
	rootCount      int
	runningIDs     []string
	gapCount       int
	missingParent  int
	brokenChain    bool
}

func (s *Service) enrichRunSegmentSummaries(ctx context.Context, runIDs []string, byRunID map[string]*RunSummary) error {
	for _, batch := range runIDBatches(runIDs, runSummaryRollupBatchSize) {
		if err := s.enrichRunSegmentSummaryBatch(ctx, batch, byRunID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) enrichRunSegmentSummaryBatch(ctx context.Context, runIDs []string, byRunID map[string]*RunSummary) error {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(runIDs)), ",")
	args := make([]any, len(runIDs))
	states := make(map[string]*runSegmentSummaryState, len(runIDs))
	for index, runID := range runIDs {
		args[index] = runID
		states[runID] = &runSegmentSummaryState{segments: map[string]struct{}{}, previousCounts: map[string]int{}}
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, segment_id, ifnull(status, ''), ifnull(previous_segment_id, ''), gap_count
		FROM run_segments WHERE run_id IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var runID, segmentID, status, previous string
		var gaps int
		if err := rows.Scan(&runID, &segmentID, &status, &previous, &gaps); err != nil {
			rows.Close()
			return err
		}
		state := states[runID]
		state.segments[segmentID] = struct{}{}
		state.gapCount += gaps
		if status == "running" {
			state.runningIDs = append(state.runningIDs, segmentID)
		}
		if previous == "" {
			state.rootCount++
		} else {
			state.previousCounts[previous]++
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}

	missingRows, err := s.db.QueryContext(ctx, `
		SELECT child.run_id, count(*)
		FROM spans child
		LEFT JOIN spans parent ON parent.span_id = child.parent_span_id AND parent.run_id = child.run_id
		WHERE child.run_id IN (`+placeholders+`) AND child.parent_span_id IS NOT NULL AND child.parent_span_id != '' AND parent.span_id IS NULL
		GROUP BY child.run_id
	`, args...)
	if err != nil {
		return err
	}
	for missingRows.Next() {
		var runID string
		var count int
		if err := missingRows.Scan(&runID, &count); err != nil {
			missingRows.Close()
			return err
		}
		states[runID].missingParent = count
	}
	if err := missingRows.Close(); err != nil {
		return err
	}

	for runID, state := range states {
		for previous, count := range state.previousCounts {
			if _, ok := state.segments[previous]; !ok {
				state.brokenChain = true
				state.gapCount++
			}
			if count > 1 {
				state.brokenChain = true
			}
		}
		run := byRunID[runID]
		if run == nil {
			return fmt.Errorf("missing run summary for segment projection %s", runID)
		}
		run.SegmentCount = len(state.segments)
		run.GapCount = state.gapCount + state.missingParent
		run.OrderingConfidence = "causal"
		if run.GapCount > 0 || state.brokenChain || state.rootCount > 1 {
			run.OrderingConfidence = "partial"
		}
		if len(state.runningIDs) == 1 {
			run.ActiveSegmentID = state.runningIDs[0]
		}
	}
	return nil
}
