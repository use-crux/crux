package server

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed embed/eval-runner.mjs
var embeddedEvalRunner []byte

//go:embed embed/source-resolver.mjs
var embeddedSourceResolver []byte

//go:embed embed/project-indexer.mjs
var embeddedProjectIndexer []byte

// cacheDir returns the platform-appropriate cache directory for crux.
func cacheDir() (string, error) {
	if dir := os.Getenv("CRUX_CACHE_DIR"); dir != "" {
		return dir, nil
	}
	base, err := os.UserCacheDir()
	if err != nil {
		// Fallback to temp directory.
		base = os.TempDir()
	}
	return filepath.Join(base, "crux"), nil
}

// ExtractEmbedded writes an embedded script to the cache directory.
// The file is version-stamped by content hash — only re-extracted when the
// binary changes. Returns the absolute path to the extracted file.
func ExtractEmbedded(name string, content []byte) (string, error) {
	dir, err := cacheDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine cache directory: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create cache directory %s: %w", dir, err)
	}

	hash := fmt.Sprintf("%x", sha256.Sum256(content))[:12]
	filename := fmt.Sprintf("%s-%s.mjs", name, hash)
	path := filepath.Join(dir, filename)

	// Already extracted with this content hash — skip.
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}

	// Write atomically: write to temp, then rename.
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return "", fmt.Errorf("cannot write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return "", fmt.Errorf("cannot rename %s to %s: %w", tmp, path, err)
	}

	return path, nil
}

// ExtractEvalRunner extracts the embedded eval-runner.mjs to the cache directory.
func ExtractEvalRunner() (string, error) {
	return ExtractEmbedded("eval-runner", embeddedEvalRunner)
}

// ExtractSourceResolver extracts the embedded source-resolver.mjs to the cache directory.
func ExtractSourceResolver() (string, error) {
	return ExtractEmbedded("source-resolver", embeddedSourceResolver)
}

// ExtractProjectIndexer extracts the embedded project-indexer.mjs to the cache directory.
func ExtractProjectIndexer() (string, error) {
	return ExtractEmbedded("project-indexer", embeddedProjectIndexer)
}

// FindNode locates the node binary, returning its path or an error with
// a user-friendly message.
func FindNode() (string, error) {
	path, err := findNodePath()
	if err != nil {
		return "", fmt.Errorf("Node.js not found. Install Node.js >= 24 or set CRUX_NODE_PATH: %w", err)
	}
	return path, nil
}

// Unused import guard — embed package must be imported for //go:embed to work.
var _ embed.FS
