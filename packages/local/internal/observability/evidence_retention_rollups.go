package observability

import (
	"context"
	"fmt"
)

func refreshEvidenceRunStorageRollups(
	ctx context.Context,
	statements *ingestStatements,
	runID string,
) error {
	if runID == "" {
		return nil
	}
	if _, err := statements.exec(ctx, `
		UPDATE runs
		SET record_count = (
				SELECT count(*) FROM records WHERE run_id = ?
			),
			span_count = (
				SELECT count(*) FROM spans WHERE run_id = ?
			),
			event_count = (
				SELECT count(*) FROM span_events WHERE run_id = ?
			),
			artifact_count = (
				SELECT count(*) FROM artifacts WHERE run_id = ?
			),
			edge_count = (
				SELECT count(*) FROM edges WHERE run_id = ?
			)
		WHERE run_id = ?
	`, runID, runID, runID, runID, runID, runID); err != nil {
		return fmt.Errorf("refresh evidence retention run rollups: %w", err)
	}
	return nil
}
