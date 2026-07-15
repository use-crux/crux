package manifeststore

import (
	"context"
	"database/sql"
	"fmt"
)

func migrate(ctx context.Context, db *sql.DB) error {
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read deployment manifest store epoch: %w", err)
	}
	if version != 0 && version != Epoch {
		return fmt.Errorf("unsupported deployment manifest store epoch %d (expected %d)", version, Epoch)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS project_index_manifests (
			project_id TEXT NOT NULL,
			manifest_id TEXT NOT NULL,
			content_json BLOB NOT NULL,
			artifact_json BLOB NOT NULL,
			imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (project_id, manifest_id)
		)
	`); err != nil {
		return fmt.Errorf("migrate deployment manifest store: %w", err)
	}
	if version == 0 {
		_, err := db.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, Epoch))
		if err == nil {
			return nil
		}
		return fmt.Errorf("set deployment manifest store epoch: %w", err)
	}
	return nil
}
