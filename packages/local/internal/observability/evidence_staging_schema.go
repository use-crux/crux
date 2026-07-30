package observability

import (
	"context"
	"fmt"
)

// rebuildProvisionalEvidenceStagingSchema removes only the unpublished staging
// shape superseded by candidate V1. Final rows survive every later restart.
func rebuildProvisionalEvidenceStagingSchema(
	ctx context.Context,
	runner sqliteRunner,
) error {
	columns, exists, err := tableColumns(
		ctx,
		runner,
		"evidence_staging_candidates",
	)
	if err != nil || !exists {
		return err
	}
	if columns["record_payload_json"] && columns["retained_bytes"] {
		return nil
	}
	if !isProvisionalEvidenceStagingShape(columns) {
		return fmt.Errorf("unrecognized evidence staging candidate schema")
	}
	if _, err := runner.ExecContext(
		ctx,
		`DROP TABLE evidence_staging_candidates`,
	); err != nil {
		return fmt.Errorf("drop provisional evidence staging schema: %w", err)
	}
	return nil
}

func isProvisionalEvidenceStagingShape(columns map[string]bool) bool {
	return columns["artifact_record_id"] &&
		columns["candidate_json"] &&
		columns["preview_json"] &&
		!columns["record_payload_json"] &&
		!columns["retained_bytes"]
}
