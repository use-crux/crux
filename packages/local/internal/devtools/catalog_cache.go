package devtools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

const catalogCacheFormatVersion = 1

type catalogCacheManifest struct {
	FormatVersion int                   `json:"formatVersion"`
	SchemaVersion int                   `json:"schemaVersion"`
	Project       store.ProjectIdentity `json:"project"`
	SnapshotFile  string                `json:"snapshotFile"`
	IndexedAt     string                `json:"indexedAt,omitempty"`
	WrittenAt     string                `json:"writtenAt"`
}

func catalogCacheFile(root string) string {
	return filepath.Join(root, ".crux", "cache", "catalog", "catalog.json")
}

func catalogCacheManifestFile(root string) string {
	return filepath.Join(root, ".crux", "cache", "catalog", "manifest.json")
}

func loadCatalogCache(root, projectName string, loadedAt time.Time) (store.CatalogData, bool) {
	if root == "" {
		return store.CatalogData{}, false
	}
	manifest, ok := loadCatalogCacheManifest(root)
	if !ok || !catalogCacheManifestMatchesProject(manifest, root) {
		return store.CatalogData{}, false
	}
	data, err := os.ReadFile(catalogCacheFile(root))
	if err != nil {
		return store.CatalogData{}, false
	}
	var catalog store.CatalogData
	if err := json.Unmarshal(data, &catalog); err != nil {
		return store.CatalogData{}, false
	}
	if catalog.SchemaVersion != manifest.SchemaVersion || !catalogCacheMatchesProject(catalog, root) {
		return store.CatalogData{}, false
	}
	if catalog.Project == nil {
		catalog.Project = &store.ProjectIdentity{Root: root, Name: projectName}
	} else if catalog.Project.Name == "" {
		catalog.Project.Name = projectName
	}
	catalog.Indexing = store.CachedCatalogIndexingStatus(catalog.Indexing, catalog.IndexedAt, loadedAt)
	return catalog, true
}

func writeCatalogCache(root string, catalog store.CatalogData) {
	if root == "" {
		return
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return
	}
	path := catalogCacheFile(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return
	}
	manifest := catalogCacheManifest{
		FormatVersion: catalogCacheFormatVersion,
		SchemaVersion: catalog.SchemaVersion,
		Project:       catalogCacheProject(catalog, root),
		SnapshotFile:  filepath.Base(path),
		IndexedAt:     catalog.IndexedAt,
		WrittenAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(catalogCacheManifestFile(root), manifestData, 0o644)
}

func catalogCacheMatchesProject(catalog store.CatalogData, root string) bool {
	if catalog.Project == nil || catalog.Project.Root == "" {
		return false
	}
	return filepath.Clean(catalog.Project.Root) == filepath.Clean(root)
}

func loadCatalogCacheManifest(root string) (catalogCacheManifest, bool) {
	data, err := os.ReadFile(catalogCacheManifestFile(root))
	if err != nil {
		return catalogCacheManifest{}, false
	}
	var manifest catalogCacheManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return catalogCacheManifest{}, false
	}
	if manifest.FormatVersion != catalogCacheFormatVersion || manifest.SnapshotFile != filepath.Base(catalogCacheFile(root)) {
		return catalogCacheManifest{}, false
	}
	return manifest, true
}

func catalogCacheManifestMatchesProject(manifest catalogCacheManifest, root string) bool {
	return filepath.Clean(manifest.Project.Root) == filepath.Clean(root)
}

func catalogCacheProject(catalog store.CatalogData, root string) store.ProjectIdentity {
	if catalog.Project != nil {
		return *catalog.Project
	}
	return store.ProjectIdentity{Root: root}
}
