package observability

import (
	"context"
	"database/sql"
	"fmt"
)

// retainOutApprovalArtifacts removes comparison and provenance data before
// routine run retention deletes their generic artifacts and records.
func retainOutApprovalArtifacts(
	ctx context.Context,
	tx *sql.Tx,
	runIDs []string,
) error {
	if len(runIDs) == 0 {
		return nil
	}
	args := append(
		[]any{localEvidenceAuthorizationNamespace},
		queryArgs(runIDs)...,
	)
	if _, err := tx.ExecContext(ctx, `
		UPDATE approval_artifact_occurrences
		SET state = 'retained-out',
			semantic_digest = NULL,
			artifact_record_id = NULL,
			accepted_at = NULL
		WHERE authorization_namespace = ?
		  AND state = 'active'
		  AND artifact_id IN (
			SELECT artifact_id FROM artifacts
			WHERE run_id IN (`+queryPlaceholders(len(runIDs))+`)
		  )
	`, args...); err != nil {
		return fmt.Errorf("retain out approval artifacts: %w", err)
	}
	return nil
}
