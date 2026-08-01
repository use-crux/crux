package eval

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

const catalogCacheVersion = 1

// Cross-process reuse must outlive one cold discovery plus normal dev-server
// startup. In-process collectors retain their much shorter refresh windows.
const catalogCacheTTL = 2 * time.Minute

type catalogCacheFile struct {
	Version   int               `json:"version"`
	FetchedAt time.Time         `json:"fetchedAt"`
	Manifests []json.RawMessage `json:"manifests"`
}

// CatalogCachePath is shared by the CLI and the in-process TUI collector.
func CatalogCachePath(projectRoot string) string {
	return filepath.Join(projectRoot, ".crux", "cache", "eval-catalog-v1.json")
}

// LoadCatalogCache returns a recent successful discovery snapshot.
func LoadCatalogCache(projectRoot string, now time.Time) ([]json.RawMessage, time.Time, error) {
	if projectRoot == "" {
		return nil, time.Time{}, nil
	}
	encoded, err := os.ReadFile(CatalogCachePath(projectRoot))
	if errors.Is(err, os.ErrNotExist) {
		return nil, time.Time{}, nil
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	var cached catalogCacheFile
	if err := json.Unmarshal(encoded, &cached); err != nil {
		return nil, time.Time{}, err
	}
	if cached.Version != catalogCacheVersion || cached.FetchedAt.IsZero() ||
		now.Sub(cached.FetchedAt) < 0 || now.Sub(cached.FetchedAt) > catalogCacheTTL {
		return nil, time.Time{}, nil
	}
	return cloneRaw(cached.Manifests), cached.FetchedAt, nil
}

// StoreCatalogCache atomically publishes one successful discovery snapshot.
func StoreCatalogCache(projectRoot string, manifests []json.RawMessage, fetchedAt time.Time) error {
	if projectRoot == "" {
		return nil
	}
	if manifests == nil {
		// Preserve an authoritative empty discovery as a cache hit. A JSON null
		// is reserved for "no cached result" by LoadCatalogCache callers.
		manifests = []json.RawMessage{}
	}
	destination := CatalogCachePath(projectRoot)
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	encoded, err := json.Marshal(catalogCacheFile{
		Version: catalogCacheVersion, FetchedAt: fetchedAt, Manifests: cloneRaw(manifests),
	})
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".eval-catalog-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(encoded); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, destination)
}
