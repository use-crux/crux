package cache

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
	_ "modernc.org/sqlite"
)

// FactStore persists Project Index facts and projects compatibility snapshots.
type FactStore interface {
	// LoadSnapshot returns a cached read model with cache status applied.
	LoadSnapshot(ctx context.Context, root, projectName string, loadedAt time.Time) (store.IndexData, bool, error)
	// CommitPhase transactionally applies one validated index phase.
	CommitPhase(ctx context.Context, tx IndexFactTransaction) error
	// ProjectSnapshot projects the current stored facts into IndexData.
	ProjectSnapshot(ctx context.Context, root, projectName string) (store.IndexData, bool, error)
}

// SQLiteIndexFactStore stores Project Index facts in the project cache DB.
type SQLiteIndexFactStore struct{}

// NewSQLiteIndexFactStore creates the default local Project Index fact store.
func NewSQLiteIndexFactStore() *SQLiteIndexFactStore {
	return &SQLiteIndexFactStore{}
}

func (s *SQLiteIndexFactStore) LoadSnapshot(ctx context.Context, root, projectName string, loadedAt time.Time) (store.IndexData, bool, error) {
	index, ok, err := s.ProjectSnapshot(ctx, root, projectName)
	if err != nil || !ok {
		return store.IndexData{}, false, err
	}
	if index.Project == nil {
		index.Project = &store.ProjectIdentity{Root: root, Name: projectName}
	} else if index.Project.Name == "" {
		index.Project.Name = projectName
	}
	index.Indexing = store.CachedIndexIndexingStatus(index.Indexing, index.IndexedAt, loadedAt)
	return index, true, nil
}

func projectIndexFactStoreDBFile(root string) string {
	return filepath.Join(
		root,
		".crux",
		"cache",
		"index-v2",
		"epoch-"+strconv.Itoa(ProjectIndexSnapshotCacheEpoch),
		"index.db",
	)
}

func openProjectIndexFactDB(root string) (*sql.DB, error) {
	if root == "" {
		return nil, fmt.Errorf("project index fact store root is empty")
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		if err != nil {
			return nil, fmt.Errorf("stat project root %q: %w", root, err)
		}
		return nil, fmt.Errorf("project root %q is not a directory", root)
	}
	path := projectIndexFactStoreDBFile(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create project index fact store directory: %w", err)
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve project index fact store path: %w", err)
	}
	db, err := sql.Open("sqlite", projectIndexFactStoreDSN(absPath))
	if err != nil {
		return nil, fmt.Errorf("open project index fact store: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func projectIndexFactStoreDSN(path string) string {
	query := url.Values{}
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "foreign_keys(ON)")
	query.Add("_pragma", "journal_mode(WAL)")
	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: query.Encode()}
	return dsn.String()
}
