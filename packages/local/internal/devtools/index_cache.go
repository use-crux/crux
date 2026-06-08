package devtools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

const indexCacheFormatVersion = 4

type indexCacheManifest struct {
	FormatVersion int                   `json:"formatVersion"`
	SchemaVersion int                   `json:"schemaVersion"`
	Project       store.ProjectIdentity `json:"project"`
	SnapshotFile  string                `json:"snapshotFile"`
	IndexedAt     string                `json:"indexedAt,omitempty"`
	WrittenAt     string                `json:"writtenAt"`
}

func indexCacheFile(root string) string {
	return filepath.Join(root, ".crux", "cache", "index", "index.json")
}

func indexCacheManifestFile(root string) string {
	return filepath.Join(root, ".crux", "cache", "index", "manifest.json")
}

func loadIndexCache(root, projectName string, loadedAt time.Time) (store.IndexData, bool) {
	if root == "" {
		return store.IndexData{}, false
	}
	manifest, ok := loadIndexCacheManifest(root)
	if !ok || !indexCacheManifestMatchesProject(manifest, root) {
		return store.IndexData{}, false
	}
	data, err := os.ReadFile(indexCacheFile(root))
	if err != nil {
		return store.IndexData{}, false
	}
	var index store.IndexData
	if err := json.Unmarshal(data, &index); err != nil {
		return store.IndexData{}, false
	}
	if index.SchemaVersion != manifest.SchemaVersion || !indexCacheMatchesProject(index, root) {
		return store.IndexData{}, false
	}
	if index.Project == nil {
		index.Project = &store.ProjectIdentity{Root: root, Name: projectName}
	} else if index.Project.Name == "" {
		index.Project.Name = projectName
	}
	index.Indexing = store.CachedIndexIndexingStatus(index.Indexing, index.IndexedAt, loadedAt)
	return index, true
}

func writeIndexCache(root string, index store.IndexData) {
	if root == "" {
		return
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return
	}
	path := indexCacheFile(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return
	}
	manifest := indexCacheManifest{
		FormatVersion: indexCacheFormatVersion,
		SchemaVersion: index.SchemaVersion,
		Project:       indexCacheProject(index, root),
		SnapshotFile:  filepath.Base(path),
		IndexedAt:     index.IndexedAt,
		WrittenAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(indexCacheManifestFile(root), manifestData, 0o644)
}

func indexCacheMatchesProject(index store.IndexData, root string) bool {
	if index.Project == nil || index.Project.Root == "" {
		return false
	}
	return filepath.Clean(index.Project.Root) == filepath.Clean(root)
}

func loadIndexCacheManifest(root string) (indexCacheManifest, bool) {
	data, err := os.ReadFile(indexCacheManifestFile(root))
	if err != nil {
		return indexCacheManifest{}, false
	}
	var manifest indexCacheManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return indexCacheManifest{}, false
	}
	if manifest.FormatVersion != indexCacheFormatVersion || manifest.SnapshotFile != filepath.Base(indexCacheFile(root)) {
		return indexCacheManifest{}, false
	}
	return manifest, true
}

func indexCacheManifestMatchesProject(manifest indexCacheManifest, root string) bool {
	return filepath.Clean(manifest.Project.Root) == filepath.Clean(root)
}

func indexCacheProject(index store.IndexData, root string) store.ProjectIdentity {
	if index.Project != nil {
		return *index.Project
	}
	return store.ProjectIdentity{Root: root}
}
