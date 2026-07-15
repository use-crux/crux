package cache

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
)

// RuntimeOverlayStore persists owner-scoped runtime contributions separately
// from compiler phase facts.
type RuntimeOverlayStore interface {
	CommitRuntimeOverlay(ctx context.Context, root string, overlay model.RuntimeOverlay) error
	DeleteRuntimeOverlay(ctx context.Context, root, ownerDefinitionID string) error
	LoadRuntimeOverlays(ctx context.Context, root string) ([]model.RuntimeOverlay, error)
}

// CommitRuntimeOverlay atomically replaces one persisted owner contribution.
func (s *SQLiteIndexFactStore) CommitRuntimeOverlay(
	ctx context.Context,
	root string,
	overlay model.RuntimeOverlay,
) error {
	if root == "" || overlay.Owner.DefinitionID == "" {
		return fmt.Errorf("runtime overlay persistence identity is incomplete")
	}
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := migrateProjectIndexFactStore(ctx, db); err != nil {
		return err
	}
	data, err := json.Marshal(overlay)
	if err != nil {
		return fmt.Errorf("marshal runtime overlay: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO index_runtime_overlays (root, owner_definition_id, overlay_json)
		VALUES (?, ?, ?)
		ON CONFLICT(root, owner_definition_id) DO UPDATE SET
			overlay_json = excluded.overlay_json,
			updated_at = CURRENT_TIMESTAMP
	`, root, overlay.Owner.DefinitionID, string(data)); err != nil {
		return fmt.Errorf("commit runtime overlay: %w", err)
	}
	return nil
}

// DeleteRuntimeOverlay removes one owner after authoritative authored removal.
func (s *SQLiteIndexFactStore) DeleteRuntimeOverlay(
	ctx context.Context,
	root string,
	ownerDefinitionID string,
) error {
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := migrateProjectIndexFactStore(ctx, db); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `DELETE FROM index_runtime_overlays WHERE root = ? AND owner_definition_id = ?`, root, ownerDefinitionID)
	return err
}

// LoadRuntimeOverlays returns persisted owner contributions in stable order.
func (s *SQLiteIndexFactStore) LoadRuntimeOverlays(
	ctx context.Context,
	root string,
) ([]model.RuntimeOverlay, error) {
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err := migrateProjectIndexFactStore(ctx, db); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT overlay_json
		FROM index_runtime_overlays
		WHERE root = ?
		ORDER BY owner_definition_id
	`, root)
	if err != nil {
		return nil, fmt.Errorf("query runtime overlays: %w", err)
	}
	defer rows.Close()
	overlays := []model.RuntimeOverlay{}
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			return nil, err
		}
		var overlay model.RuntimeOverlay
		if err := json.Unmarshal([]byte(encoded), &overlay); err != nil {
			return nil, fmt.Errorf("decode runtime overlay: %w", err)
		}
		overlays = append(overlays, overlay)
	}
	return overlays, rows.Err()
}
