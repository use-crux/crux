package workerproc

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
)

func cacheDir() (string, error) {
	if dir := os.Getenv("CRUX_CACHE_DIR"); dir != "" {
		return dir, nil
	}
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "crux"), nil
}

// ExtractEmbedded writes an embedded script to the content-addressed cache.
func ExtractEmbedded(name string, content []byte) (string, error) {
	dir, err := cacheDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine cache directory: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create cache directory %s: %w", dir, err)
	}

	hash := fmt.Sprintf("%x", sha256.Sum256(content))[:12]
	path := filepath.Join(dir, fmt.Sprintf("%s-%s.mjs", name, hash))
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return "", fmt.Errorf("cannot write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("cannot rename %s to %s: %w", tmp, path, err)
	}
	return path, nil
}
