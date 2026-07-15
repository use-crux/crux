package manifeststore

import (
	"context"
	"fmt"
)

func (s *Store) insertFixture(ctx context.Context, projectID, manifestID string, content []byte) error {
	db, err := s.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.ExecContext(ctx, `
		INSERT INTO project_index_manifests (project_id, manifest_id, content_json, artifact_json)
		VALUES (?, ?, ?, ?)
	`, projectID, manifestID, content, []byte(`{}`))
	if err != nil {
		return fmt.Errorf("insert manifest fixture: %w", err)
	}
	return nil
}
