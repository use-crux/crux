package commands

import (
	"fmt"
	"os"
	"path/filepath"
)

func writeFileAtomically(path string, content []byte) (err error) {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create manifest output directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".crux-manifest-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary manifest: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if err != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err = temporary.Chmod(0o644); err != nil {
		return fmt.Errorf("set temporary manifest permissions: %w", err)
	}
	if _, err = temporary.Write(content); err != nil {
		return fmt.Errorf("write temporary manifest: %w", err)
	}
	if len(content) == 0 || content[len(content)-1] != '\n' {
		if _, err = temporary.Write([]byte{'\n'}); err != nil {
			return fmt.Errorf("terminate temporary manifest: %w", err)
		}
	}
	if err = temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary manifest: %w", err)
	}
	if err = temporary.Close(); err != nil {
		return fmt.Errorf("close temporary manifest: %w", err)
	}
	if err = os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace manifest artifact: %w", err)
	}
	return nil
}
