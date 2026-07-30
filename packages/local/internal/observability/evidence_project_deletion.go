package observability

import (
	"context"
	"fmt"
)

// deleteEvidenceProjectRows removes the complete project-local evidence store.
// Callers own the transaction so project deletion can commit this cleanup with
// the rest of the project's private state.
func deleteEvidenceProjectRows(
	ctx context.Context,
	runner sqliteRunner,
) error {
	for _, table := range evidenceTableNamesForDeletion() {
		if _, err := runner.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return fmt.Errorf("delete project evidence table %s: %w", table, err)
		}
	}
	return nil
}
