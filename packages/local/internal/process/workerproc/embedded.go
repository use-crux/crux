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

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return "", fmt.Errorf("cannot create temporary worker in %s: %w", dir, err)
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("cannot write %s: %w", tmpPath, err)
	}
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("cannot set permissions on %s: %w", tmpPath, err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("cannot close %s: %w", tmpPath, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		// Another process may have won the same content-addressed write.
		if _, statErr := os.Stat(path); statErr == nil {
			return path, nil
		}
		return "", fmt.Errorf("cannot rename %s to %s: %w", tmpPath, path, err)
	}
	return path, nil
}
