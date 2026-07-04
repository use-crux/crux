package observability

import (
	"context"
)

type runRollupDelta struct {
	runID             string
	recordCount       int
	spanCount         int
	eventCount        int
	artifactCount     int
	edgeCount         int
	totalInputTokens  int
	totalOutputTokens int
	totalCostUSD      float64
	lastActivityAt    string
}

func rollupDeltaForRunStart(run RunStartRecord, storedInserted bool) runRollupDelta {
	return runRollupDelta{
		runID:          run.RunID,
		recordCount:    boolInt(storedInserted),
		lastActivityAt: run.StartedAt,
	}
}

func rollupDeltaForRunEnd(run RunEndRecord, storedInserted bool) runRollupDelta {
	return runRollupDelta{
		runID:          run.RunID,
		recordCount:    boolInt(storedInserted),
		lastActivityAt: run.EndedAt,
	}
}

func rollupDeltaForSpanStart(span SpanStartRecord, storedInserted bool, spanInserted bool) runRollupDelta {
	return runRollupDelta{
		runID:          span.RunID,
		recordCount:    boolInt(storedInserted),
		spanCount:      boolInt(spanInserted),
		lastActivityAt: span.StartedAt,
	}
}

func rollupDeltaForSpanEnd(span SpanEndRecord, storedInserted bool, spanInserted bool, rollupUsage bool) runRollupDelta {
	delta := runRollupDelta{
		runID:          span.RunID,
		recordCount:    boolInt(storedInserted),
		spanCount:      boolInt(spanInserted),
		lastActivityAt: span.EndedAt,
	}
	if storedInserted && rollupUsage {
		delta.addUsage(metricsFromRaw(span.Metrics))
	}
	return delta
}

func rollupDeltaForSpanEvent(event SpanEventRecord, storedInserted bool, eventInserted bool, rollupUsage bool) runRollupDelta {
	delta := runRollupDelta{
		runID:          event.RunID,
		recordCount:    boolInt(storedInserted),
		eventCount:     boolInt(eventInserted),
		lastActivityAt: event.Timestamp,
	}
	if storedInserted && rollupUsage {
		delta.addUsage(metricsFromRaw(event.Attributes))
	}
	return delta
}

func rollupDeltaForArtifact(artifact ArtifactRecord, storedInserted bool, artifactInserted bool) runRollupDelta {
	return runRollupDelta{
		runID:          artifact.RunID,
		recordCount:    boolInt(storedInserted),
		artifactCount:  boolInt(artifactInserted),
		lastActivityAt: artifact.CreatedAt,
	}
}

func rollupDeltaForEdge(edge EdgeRecord, storedInserted bool, edgeInserted bool) runRollupDelta {
	return runRollupDelta{
		runID:          edge.RunID,
		recordCount:    boolInt(storedInserted),
		edgeCount:      boolInt(edgeInserted),
		lastActivityAt: edge.CreatedAt,
	}
}

func rollupDeltaForSpan(span SpanRecord, storedInserted bool, spanInserted bool, rollupUsage bool) runRollupDelta {
	delta := runRollupDelta{
		runID:          span.RunID,
		recordCount:    boolInt(storedInserted),
		spanCount:      boolInt(spanInserted),
		lastActivityAt: firstNonEmptyString(span.EndedAt, span.StartedAt),
	}
	if storedInserted && rollupUsage {
		delta.addUsage(metricsFromRaw(span.Metrics))
	}
	return delta
}

func rollupDeltaForUnknown(record Record, storedInserted bool) runRollupDelta {
	return runRollupDelta{
		runID:       record.RunID,
		recordCount: boolInt(storedInserted),
	}
}

func (delta *runRollupDelta) addUsage(metrics map[string]float64) {
	delta.totalInputTokens += int(metrics["inputTokens"])
	delta.totalOutputTokens += int(metrics["outputTokens"])
	delta.totalCostUSD += metrics["costUsd"]
}

func updateRunRollups(ctx context.Context, statements *ingestStatements, delta runRollupDelta) error {
	if delta.runID == "" {
		return nil
	}
	if err := reserveRunRollup(ctx, statements, delta.runID); err != nil {
		return err
	}
	_, err := statements.exec(ctx, `
		UPDATE runs
		SET record_count = record_count + ?,
			span_count = span_count + ?,
			event_count = event_count + ?,
			artifact_count = artifact_count + ?,
			edge_count = edge_count + ?,
			total_input_tokens = total_input_tokens + ?,
			total_output_tokens = total_output_tokens + ?,
			total_cost_usd = total_cost_usd + ?,
			last_activity_at = CASE
				WHEN ? = '' THEN last_activity_at
				WHEN last_activity_at IS NULL OR last_activity_at < ? THEN ?
				ELSE last_activity_at
			END,
			lifecycle_status = CASE WHEN ? > 0 THEN NULL ELSE lifecycle_status END,
			lifecycle_checked_at = CASE WHEN ? > 0 THEN NULL ELSE lifecycle_checked_at END
		WHERE run_id = ?
	`, delta.recordCount, delta.spanCount, delta.eventCount, delta.artifactCount, delta.edgeCount,
		delta.totalInputTokens, delta.totalOutputTokens, delta.totalCostUSD,
		delta.lastActivityAt, delta.lastActivityAt, delta.lastActivityAt,
		delta.recordCount, delta.recordCount, delta.runID)
	return err
}

func reserveRunRollup(ctx context.Context, statements *ingestStatements, runID string) error {
	if _, ok := statements.reservedRunRollups[runID]; ok {
		return nil
	}
	if _, err := statements.exec(ctx, `INSERT INTO runs (run_id) VALUES (?) ON CONFLICT(run_id) DO NOTHING`, runID); err != nil {
		return err
	}
	statements.reservedRunRollups[runID] = struct{}{}
	return nil
}

func applyStoredUsageRollups(run *RunSummary, metrics map[string]float64) {
	if run == nil {
		return
	}
	stored := map[string]float64{}
	if run.inputTokens != 0 {
		stored["inputTokens"] = float64(run.inputTokens)
	}
	if run.outputTokens != 0 {
		stored["outputTokens"] = float64(run.outputTokens)
	}
	if run.costUSD != 0 {
		stored["costUsd"] = run.costUSD
	}
	mergeMissingOrZeroMetrics(metrics, stored)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
