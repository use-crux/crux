package editorcmd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

func writeDownloadedAsset(directory, name string, contents []byte) (string, error) {
	absoluteDirectory, err := filepath.Abs(directory)
	if err != nil {
		return "", fmt.Errorf("resolve extension download directory: %w", err)
	}
	if err := os.MkdirAll(absoluteDirectory, 0o755); err != nil {
		return "", fmt.Errorf("create extension download directory: %w", err)
	}
	target := filepath.Join(absoluteDirectory, name)
	if existing, err := os.ReadFile(target); err == nil {
		if bytes.Equal(existing, contents) {
			return target, nil
		}
		return "", fmt.Errorf("refusing to overwrite different extension bytes at %s", target)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("inspect existing extension download: %w", err)
	}

	temporary, err := os.CreateTemp(absoluteDirectory, "."+name+".tmp-*")
	if err != nil {
		return "", fmt.Errorf("create temporary extension download: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o644); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("prepare extension download: %w", err)
	}
	if _, err := temporary.Write(contents); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("write extension download: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("flush extension download: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close extension download: %w", err)
	}
	if err := os.Link(temporaryPath, target); err != nil {
		if existing, readErr := os.ReadFile(target); readErr == nil {
			if bytes.Equal(existing, contents) {
				return target, nil
			}
			return "", fmt.Errorf("refusing to overwrite different extension bytes at %s", target)
		}
		return "", fmt.Errorf("publish extension download: %w", err)
	}
	return target, nil
}
