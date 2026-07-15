// Package manifeststore persists immutable Project Index deployment manifests.
package manifeststore

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"

	"github.com/use-crux/crux/packages/local/internal/projectindex/manifestcontract"
	_ "modernc.org/sqlite"
)

// Epoch identifies the on-disk manifest-store contract. A new filename keeps
// incompatible historical joins from being masked by a stale earlier store.
const Epoch = 1

// ErrTupleCollision reports an immutable tuple whose stored content differs.
var ErrTupleCollision = errors.New("deployment manifest tuple collision")

// Store locates the dedicated manifest database below one project root.
type Store struct{ root string }

// ImportResult reports whether an immutable artifact was newly persisted.
type ImportResult struct {
	Status   string
	Manifest manifestcontract.DeploymentManifest
}

// New creates a manifest store locator. Databases are opened per bounded
// operation so CLI and local-server processes can safely share the file.
func New(root string) *Store { return &Store{root: root} }

// Import validates and atomically inserts one manifest tuple.
func (s *Store) Import(ctx context.Context, artifact []byte) (ImportResult, error) {
	manifest, err := s.parseVerified(artifact)
	if err != nil {
		return ImportResult{}, err
	}
	content, err := json.Marshal(manifest.Content)
	if err != nil {
		return ImportResult{}, fmt.Errorf("encode deployment manifest content: %w", err)
	}
	db, err := s.open(ctx)
	if err != nil {
		return ImportResult{}, err
	}
	defer db.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, fmt.Errorf("begin deployment manifest import: %w", err)
	}
	defer tx.Rollback()
	var existing []byte
	err = tx.QueryRowContext(ctx, `
		SELECT content_json FROM project_index_manifests
		WHERE project_id = ? AND manifest_id = ?
	`, manifest.ProjectID, manifest.ManifestID).Scan(&existing)
	if err == nil {
		if !bytes.Equal(existing, content) {
			return ImportResult{}, fmt.Errorf("%w for (%s, %s)", ErrTupleCollision, manifest.ProjectID, manifest.ManifestID)
		}
		return ImportResult{Status: "already-present", Manifest: manifest}, nil
	}
	if err != sql.ErrNoRows {
		return ImportResult{}, fmt.Errorf("query deployment manifest tuple: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO project_index_manifests (
			project_id, manifest_id, content_json, artifact_json
		) VALUES (?, ?, ?, ?)
	`, manifest.ProjectID, manifest.ManifestID, content, bytes.TrimSpace(artifact)); err != nil {
		return ImportResult{}, fmt.Errorf("insert deployment manifest: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ImportResult{}, fmt.Errorf("commit deployment manifest import: %w", err)
	}
	return ImportResult{Status: "imported", Manifest: manifest}, nil
}

// Get returns one exact historical manifest tuple.
func (s *Store) Get(ctx context.Context, projectID, manifestID string) (manifestcontract.DeploymentManifest, bool, error) {
	db, err := s.open(ctx)
	if err != nil {
		return manifestcontract.DeploymentManifest{}, false, err
	}
	defer db.Close()
	var artifact []byte
	err = db.QueryRowContext(ctx, `
		SELECT artifact_json FROM project_index_manifests
		WHERE project_id = ? AND manifest_id = ?
	`, projectID, manifestID).Scan(&artifact)
	if err == sql.ErrNoRows {
		return manifestcontract.DeploymentManifest{}, false, nil
	}
	if err != nil {
		return manifestcontract.DeploymentManifest{}, false, fmt.Errorf("query deployment manifest: %w", err)
	}
	manifest, err := s.parseVerified(artifact)
	if err != nil {
		return manifestcontract.DeploymentManifest{}, false, fmt.Errorf("stored deployment manifest failed integrity verification: %w", err)
	}
	return manifest, true, nil
}

// Count returns the number of immutable manifest tuples in the current epoch.
func (s *Store) Count(ctx context.Context) (int, error) {
	db, err := s.open(ctx)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM project_index_manifests`).Scan(&count); err != nil {
		return 0, fmt.Errorf("count deployment manifests: %w", err)
	}
	return count, nil
}

// SoleIdentity returns the imported manifest only when the local store contains
// exactly one tuple. Multiple historical imports do not imply a current
// deployment and therefore remain unresolved.
func (s *Store) SoleIdentity(ctx context.Context) (manifestcontract.DeploymentManifest, bool, error) {
	db, err := s.open(ctx)
	if err != nil {
		return manifestcontract.DeploymentManifest{}, false, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `
		SELECT artifact_json FROM project_index_manifests
		ORDER BY imported_at DESC, rowid DESC
		LIMIT 2
	`)
	if err != nil {
		return manifestcontract.DeploymentManifest{}, false, fmt.Errorf("query current deployment manifest: %w", err)
	}
	defer rows.Close()
	artifacts := make([][]byte, 0, 2)
	for rows.Next() {
		var artifact []byte
		if err := rows.Scan(&artifact); err != nil {
			return manifestcontract.DeploymentManifest{}, false, fmt.Errorf("scan current deployment manifest: %w", err)
		}
		artifacts = append(artifacts, artifact)
	}
	if err := rows.Err(); err != nil {
		return manifestcontract.DeploymentManifest{}, false, fmt.Errorf("iterate current deployment manifests: %w", err)
	}
	if len(artifacts) != 1 {
		return manifestcontract.DeploymentManifest{}, false, nil
	}
	manifest, err := s.parseVerified(artifacts[0])
	if err != nil {
		return manifestcontract.DeploymentManifest{}, false, fmt.Errorf("stored current deployment manifest failed integrity verification: %w", err)
	}
	return manifest, true, nil
}

func (s *Store) parseVerified(artifact []byte) (manifestcontract.DeploymentManifest, error) {
	manifest, err := manifestcontract.Parse(artifact)
	if err == nil {
		err = manifestcontract.Verify(manifest)
	}
	if err != nil {
		return manifestcontract.DeploymentManifest{}, fmt.Errorf("invalid deployment manifest: %w", err)
	}
	return manifest, nil
}

func (s *Store) open(ctx context.Context) (*sql.DB, error) {
	if s == nil || s.root == "" {
		return nil, errors.New("deployment manifest store root is empty")
	}
	path := filepath.Join(s.root, ".crux", "catalog", "manifests-v"+strconv.Itoa(Epoch)+".sqlite")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create deployment manifest store directory: %w", err)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve deployment manifest store path: %w", err)
	}
	query := url.Values{}
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "journal_mode(WAL)")
	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(absolute), RawQuery: query.Encode()}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, fmt.Errorf("open deployment manifest store: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
